import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditService } from '../../src/common/audit/audit.service';
import { PrepOrderLine } from '../../src/modules/prep/entities/prep-order-line.entity';
import { createPrepTestApp, PrepTestContext } from './prep.setup';

/**
 * 生产发料链 prep e2e（REQ-005~008 + 纪要新增）。
 * 覆盖：齐套计算 / 未齐套禁备料 / 扫码校验 / 分次备料+中断恢复 /
 * 完成占用 / 双确认+U8出库+扣实物 / 过账前退回 / 重复完成幂等。
 */
describe('prep 生产发料链 e2e', () => {
  let ctx: PrepTestContext;
  let server: any;
  let admin: string;
  let keeper: string;
  let receiver: string;
  let ridSeq = 0;
  const rid = () => `prep-e2e-${++ridSeq}`;

  // 跨用例共享的业务数据
  let taskK3Id: number;
  let prepDocK3: string;

  beforeAll(async () => {
    ctx = await createPrepTestApp();
    server = ctx.server;
    admin = ctx.tokens.admin;
    keeper = ctx.tokens.keeper01;
    receiver = ctx.tokens.receiver01;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createMaterial(materialCode: string, safetyStock = 0) {
    const res = await request(server)
      .post('/api/masterdata/materials')
      .set(auth(admin))
      .send({ materialCode, name: `物料${materialCode}`, safetyStock, unit: 'PCS' });
    expect(res.status).toBe(201);
  }

  async function createWorkOrder(workOrderId: string, productCode: string, planQty: number) {
    const res = await request(server)
      .post('/api/masterdata/work-orders')
      .set(auth(admin))
      .send({ workOrderId, productCode, planQty, planDate: '2026-07-25', status: 'RELEASED' });
    expect(res.status).toBe(201);
  }

  async function createBom(bomCode: string, productCode: string, items: { materialCode: string; qty: number }[]) {
    const res = await request(server)
      .post('/api/masterdata/boms')
      .set(auth(admin))
      .send({
        bomCode,
        productCode,
        version: 1,
        items: items.map((i) => ({ bomCode, materialCode: i.materialCode, qty: i.qty, unit: 'PCS' })),
      });
    expect(res.status).toBe(201);
  }

  async function inbound(packageNo: string, materialCode: string, qty: number, status = 'QUALIFIED') {
    const res = await request(server)
      .post('/api/inventory/inbound')
      .set(auth(admin))
      .set('X-Request-Id', rid())
      .send({
        packageNo,
        materialCode,
        batchNo: `B-${packageNo}`,
        qty,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        status,
        sourceDocNo: 'RCV-PREP-E2E',
      });
    expect(res.status).toBe(201);
  }

  async function available(materialCode: string) {
    const res = await request(server)
      .get(`/api/inventory/available/${materialCode}`)
      .set(auth(admin));
    expect(res.status).toBe(200);
    return res.body;
  }

  // ① 齐套计算正确：合格 100、占用 30、安全库存 10 → available 60
  it('①齐套计算：available = 合格100 − 占用30 − 安全库存10 = 60，三区域可视', async () => {
    await createMaterial('M-K1', 10);
    await inbound('PKG-K1', 'M-K1', 100);
    await inbound('PKG-K1I', 'M-K1', 7, 'PENDING_INSPECTION'); // 待检：可视但不计可用
    // 外部占用 30
    const occ = await request(server)
      .post('/api/inventory/occupy')
      .set(auth(admin))
      .set('X-Request-Id', rid())
      .send({ workOrderId: 'WO-EXT', items: [{ materialCode: 'M-K1', qty: 30 }], prepDocNo: 'PREP-EXT-1' });
    expect(occ.status).toBe(201);

    await createWorkOrder('WO-K1', 'P-K1', 10);
    await createBom('BOM-PK1', 'P-K1', [{ materialCode: 'M-K1', qty: 5 }]); // 需求 5×10=50

    const res = await request(server)
      .get('/api/prep/kitting?workOrderId=WO-K1')
      .set(auth(keeper));
    expect(res.status).toBe(200);
    expect(res.body.kitting).toBe(true);
    expect(res.body.status).toBe('KIT');
    const line = res.body.lines[0];
    expect(line.materialCode).toBe('M-K1');
    expect(line.requiredQty).toBe(50);
    expect(line.qualifiedQty).toBe(100);
    expect(line.occupiedQty).toBe(30);
    expect(line.safetyStock).toBe(10);
    expect(line.available).toBe(60);
    expect(line.visibility.qualified).toBe(100);
    expect(line.visibility.pendingInspection).toBe(7);

    // 看板包含该工单
    const board = await request(server).get('/api/prep/kitting/board').set(auth(keeper));
    expect(board.status).toBe(200);
    const row = board.body.find((r: any) => r.workOrderId === 'WO-K1');
    expect(row?.status).toBe('KIT');
  });

  // ② 未齐套禁备料 + 缺料明细
  it('②未齐套：整单备料被拒并返回缺料明细', async () => {
    await createMaterial('M-K2', 0);
    await inbound('PKG-K2', 'M-K2', 10);
    await createWorkOrder('WO-K2', 'P-K2', 10);
    await createBom('BOM-PK2', 'P-K2', [{ materialCode: 'M-K2', qty: 2 }]); // 需求 20，可用 10

    const k = await request(server).get('/api/prep/kitting?workOrderId=WO-K2').set(auth(keeper));
    expect(k.body.kitting).toBe(false);
    expect(k.body.status).toBe('SHORTAGE');
    expect(k.body.shortageLines).toEqual([
      { materialCode: 'M-K2', requiredQty: 20, available: 10, shortageQty: 10 },
    ]);

    const res = await request(server)
      .post('/api/prep/tasks')
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ workOrderId: 'WO-K2' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('KITTING_SHORTAGE');
    expect(res.body.message).toContain('M-K2');
    expect(res.body.message).toContain('shortageQty');
  });

  it('②b 紧急生产：prep.allowEmergency=true + emergencyReason 强制放行并审计', async () => {
    const rule = await request(server)
      .post('/api/config/rules')
      .set(auth(admin))
      .send({ key: 'prep.allowEmergency', value: 'true' });
    expect(rule.status).toBe(201);

    const res = await request(server)
      .post('/api/prep/tasks')
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ workOrderId: 'WO-K2', emergencyReason: '紧急生产插单' });
    expect(res.status).toBe(201);
    expect(res.body.task.emergency).toBe(true);
    expect(res.body.task.emergencyReason).toBe('紧急生产插单');

    const audit: AuditService = ctx.app.get(AuditService);
    const logs = await audit.query({ action: 'prep.emergencyOverride' });
    expect(logs.some((l) => l.docNo === 'WO-K2' && l.operator === 'keeper01')).toBe(true);
  });

  // ③ 扫错物料 / 超应备数量被拒
  it('③扫码校验：错物料、超应备数量被拒；FIFO 推荐储位', async () => {
    await createMaterial('M-K3', 0);
    await createMaterial('M-X3', 0);
    await inbound('PKG-K3A', 'M-K3', 12);
    await inbound('PKG-K3B', 'M-K3', 10);
    await inbound('PKG-X3', 'M-X3', 5);
    await createWorkOrder('WO-K3', 'P-K3', 10);
    await createBom('BOM-PK3', 'P-K3', [{ materialCode: 'M-K3', qty: 2 }]); // 应备 20

    const created = await request(server)
      .post('/api/prep/tasks')
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ workOrderId: 'WO-K3' });
    expect(created.status).toBe(201);
    taskK3Id = created.body.task.id;
    expect(created.body.lines[0].requiredQty).toBe(20);
    // 推荐储位：M-K3 两个合格批次
    expect(created.body.recommendations['M-K3']).toHaveLength(2);
    expect(created.body.recommendations['M-K3'].map((r: any) => r.packageNo).sort()).toEqual([
      'PKG-K3A',
      'PKG-K3B',
    ]);

    // 扫错物料（不属于工单需求）
    const wrong = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-X3' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('MATERIAL_NOT_REQUIRED');

    // 正常扫描 12
    const ok = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-K3A', device: 'PDA-01' });
    expect(ok.status).toBe(201);
    expect(ok.body.lines[0].preparedQty).toBe(12);

    // 超应备：12 + 10 > 20
    const exceed = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-K3B' });
    expect(exceed.status).toBe(400);
    expect(exceed.body.code).toBe('PREP_EXCEED_REQUIRED');
  });

  // ④ 分次备料 + 中断恢复（同码重扫不重复累计）
  it('④分次备料+暂存中断恢复：同码重扫不重复累计', async () => {
    // 暂存（中断）
    const sus = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/suspend`)
      .set(auth(keeper))
      .set('X-Request-Id', rid());
    expect(sus.status).toBe(201);
    expect(sus.body.task.status).toBe('SUSPENDED');

    // 重登恢复：进度仍在（已备 12）
    const detail = await request(server)
      .get(`/api/prep/tasks/${taskK3Id}`)
      .set(auth(keeper));
    expect(detail.body.task.status).toBe('SUSPENDED');
    expect(detail.body.lines[0].preparedQty).toBe(12);
    expect(detail.body.scans).toHaveLength(1);
    expect(detail.body.scans[0].operator).toBe('keeper01');

    // 同码重扫：不重复累计，且任务自动恢复 OPEN
    const dup = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-K3A' });
    expect(dup.status).toBe(201);
    expect(dup.body.duplicated).toBe(true);
    expect(dup.body.lines[0].preparedQty).toBe(12);

    const resumed = await request(server)
      .get(`/api/prep/tasks/${taskK3Id}`)
      .set(auth(keeper));
    expect(resumed.body.task.status).toBe('OPEN');

    // 分次：第二次扫码部分数量 8 → 累计 20 = 应备
    const second = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-K3B', qty: 8 });
    expect(second.status).toBe(201);
    expect(second.body.lines[0].preparedQty).toBe(20);
    expect(second.body.lines[0].remainingQty).toBe(0);
  });

  // ⑤⑧ 完成备料 → 占用增加 → available 减少；重复 complete 不重复占用
  it('⑤⑧完成备料占用增加、available 减少；重复 complete（同/异 requestId）不重复占用', async () => {
    const before = await available('M-K3');
    expect(before.qualifiedQty).toBe(22);
    expect(before.occupiedQty).toBe(0);
    expect(before.available).toBe(22);

    const done = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/complete`)
      .set(auth(keeper))
      .set('X-Request-Id', 'prep-e2e-complete-1');
    expect(done.status).toBe(201);
    prepDocK3 = done.body.order.prepDocNo;
    expect(prepDocK3).toMatch(/^PREP/);
    expect(done.body.order.status).toBe('APPROVED');
    expect(done.body.lines[0].preparedQty).toBe(20);

    const after = await available('M-K3');
    expect(after.occupiedQty).toBe(20);
    expect(after.available).toBe(2);

    // 齐套重算：占用后 available 下降
    const k = await request(server).get('/api/prep/kitting?workOrderId=WO-K3').set(auth(keeper));
    expect(k.body.lines[0].available).toBe(2);

    // 同 requestId 重放：幂等拦截器返回首个响应
    const replay = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/complete`)
      .set(auth(keeper))
      .set('X-Request-Id', 'prep-e2e-complete-1');
    expect(replay.status).toBe(201);
    expect(replay.body.order.prepDocNo).toBe(prepDocK3);

    // 不同 requestId 重复 complete：服务层按任务状态去重
    const again = await request(server)
      .post(`/api/prep/tasks/${taskK3Id}/complete`)
      .set(auth(keeper))
      .set('X-Request-Id', rid());
    expect(again.status).toBe(201);
    expect(again.body.order.prepDocNo).toBe(prepDocK3);

    const final = await available('M-K3');
    expect(final.occupiedQty).toBe(20); // 未重复占用
  });

  // ⑥ 双确认：同账号被拒 → 两账号确认 → U8 SYNCED → 扣实物+释放占用；leftover/AGV/更正
  it('⑥物权交接双确认 → U8 材料出库 SYNCED → 实物扣减+占用释放（含审计/AGV/更正）', async () => {
    // 仓管员确认
    const c1 = await request(server)
      .post(`/api/prep/${prepDocK3}/handover/confirm`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ role: 'KEEPER', device: 'PDA-K1' });
    expect(c1.status).toBe(201);
    expect(c1.body.handoverCompleted).toBe(false);
    expect(c1.body.order.keeperBy).toBe('keeper01');

    // 同一账号第二次确认（换角色也不行）→ 拒绝
    const same = await request(server)
      .post(`/api/prep/${prepDocK3}/handover/confirm`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ role: 'RECEIVER' });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('SAME_ACCOUNT_CONFIRM');

    // 生产接收人确认 → 双方完成 → U8 材料出库单 SYNCED → 扣实物 + 占用释放
    const c2 = await request(server)
      .post(`/api/prep/${prepDocK3}/handover/confirm`)
      .set(auth(receiver))
      .set('X-Request-Id', rid())
      .send({ role: 'RECEIVER', device: 'PDA-R1' });
    expect(c2.status).toBe(201);
    expect(c2.body.handoverCompleted).toBe(true);
    expect(c2.body.order.receiverBy).toBe('receiver01');
    expect(c2.body.order.status).toBe('SYNCED');
    expect(c2.body.order.postedAt).toBeTruthy();
    expect(c2.body.syncTask.status).toBe('SYNCED');
    expect(c2.body.syncTask.voucherType).toBe('MATERIAL_ISSUE');
    expect(c2.body.leftoverReminder.flag).toBe(false); // 实备 20 = 应备 20

    // 实物 FIFO 扣减：PKG-K3A 12→0，PKG-K3B 10→2；占用 CONSUMED
    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-K3')
      .set(auth(admin));
    const lotA = lots.body.find((l: any) => l.packageNo === 'PKG-K3A');
    const lotB = lots.body.find((l: any) => l.packageNo === 'PKG-K3B');
    expect(lotA.qty).toBe(0);
    expect(lotB.qty).toBe(2);
    const after = await available('M-K3');
    expect(after.qualifiedQty).toBe(2);
    expect(after.occupiedQty).toBe(0);
    expect(after.available).toBe(2);

    // 审计：两次确认 + 过账
    const audit: AuditService = ctx.app.get(AuditService);
    const logs = await audit.query({ docNo: prepDocK3 });
    const actions = logs.map((l) => `${l.action}:${l.result}`);
    expect(actions.filter((a) => a === 'prep.handover.confirm:SUCCESS')).toHaveLength(2);
    expect(actions).toContain('prep.issue.posted:SUCCESS');

    // AGV 预留接口：占位数据
    const agv = await request(server)
      .get(`/api/prep/${prepDocK3}/agv-task`)
      .set(auth(keeper));
    expect(agv.status).toBe(200);
    expect(agv.body).toEqual({
      taskNo: `AGV-${prepDocK3}`,
      sourceLocation: 'STAGING',
      targetLine: 'WO-K3',
      materialCode: 'M-K3',
      quantity: 20,
      unit: 'PCS',
      weight: 0,
    });

    // 过账后退回被拒 → 只能更正（ReversalDoc + 原单 REVERSED）
    const rej = await request(server)
      .post(`/api/prep/${prepDocK3}/handover/reject`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ reason: '过账后退回应被拒' });
    expect(rej.status).toBe(400);
    expect(rej.body.code).toBe('ALREADY_POSTED_USE_REVERSAL');

    const rev = await request(server)
      .post(`/api/prep/${prepDocK3}/reversal`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ reason: '发料数量差异更正' });
    expect(rev.status).toBe(201);
    expect(rev.body.reversal.reversalNo).toMatch(/^RVS/);
    expect(rev.body.order.order.status).toBe('REVERSED');
    const revLogs = await audit.query({ docNo: prepDocK3 });
    expect(revLogs.some((l) => l.action === 'prep.reversal')).toBe(true);
  });

  it('⑥b 余料提醒：已备未用（实备>应备）时 leftoverReminder 输出', async () => {
    // 模拟 BOM 变更后应备下调：实备 20 > 应备 15 → 余料 5
    await ctx.ds
      .getRepository(PrepOrderLine)
      .update({ prepDocNo: prepDocK3, materialCode: 'M-K3' }, { requiredQty: 15 });
    const detail = await request(server)
      .get(`/api/prep/orders/${prepDocK3}`)
      .set(auth(keeper));
    expect(detail.status).toBe(200);
    expect(detail.body.leftoverReminder.flag).toBe(true);
    expect(detail.body.leftoverReminder.items).toEqual([
      { materialCode: 'M-K3', requiredQty: 15, preparedQty: 20, leftoverQty: 5 },
    ]);
  });

  // ⑦ 过账前退回：释放占用，退回备料任务
  it('⑦过账前退回：释放占用、备料单作废、任务退回 OPEN（含审计）', async () => {
    await createMaterial('M-K4', 0);
    await inbound('PKG-K4', 'M-K4', 50);
    await createWorkOrder('WO-K4', 'P-K4', 10);
    await createBom('BOM-PK4', 'P-K4', [{ materialCode: 'M-K4', qty: 3 }]); // 应备 30

    const created = await request(server)
      .post('/api/prep/tasks')
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ workOrderId: 'WO-K4' });
    const taskId = created.body.task.id;
    await request(server)
      .post(`/api/prep/tasks/${taskId}/scan`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ packageNo: 'PKG-K4', qty: 30 });
    const done = await request(server)
      .post(`/api/prep/tasks/${taskId}/complete`)
      .set(auth(keeper))
      .set('X-Request-Id', rid());
    const prepDocNo = done.body.order.prepDocNo;

    const during = await available('M-K4');
    expect(during.occupiedQty).toBe(30);
    expect(during.available).toBe(20);

    const rej = await request(server)
      .post(`/api/prep/${prepDocNo}/handover/reject`)
      .set(auth(keeper))
      .set('X-Request-Id', rid())
      .send({ reason: '交接差异，退回备料' });
    expect(rej.status).toBe(201);
    expect(rej.body.order.status).toBe('VOID');

    const restored = await available('M-K4');
    expect(restored.occupiedQty).toBe(0);
    expect(restored.available).toBe(50);

    // 退回备料任务：任务回到 OPEN，扫码进度保留
    const task = await request(server).get(`/api/prep/tasks/${taskId}`).set(auth(keeper));
    expect(task.body.task.status).toBe('OPEN');
    expect(task.body.lines[0].preparedQty).toBe(30);

    const audit: AuditService = ctx.app.get(AuditService);
    const logs = await audit.query({ docNo: prepDocNo });
    expect(logs.some((l) => l.action === 'prep.handover.reject' && l.result === 'SUCCESS')).toBe(true);
  });
});
