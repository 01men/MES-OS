import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createReceivingTestApp, ReceivingTestContext } from './receiving.setup';
import { ApprovalEngineService } from '../../src/common/approval/approval.service';
import { ApprovalStatus } from '../../src/common/enums';
import {
  PoOrderType,
  RcvPurchaseOrder,
  RcvPurchaseOrderLine,
} from '../../src/modules/receiving/entities/purchase-order.entity';

/**
 * receiving 模块 e2e：三步链 / 部分接收 / 特采 MRB / ABC 清点 / 委外 / 幂等 / 补打。
 * 独立 setup（receiving.setup.ts），不改动共享测试文件。
 */
describe('receiving 来料链接收 e2e', () => {
  let ctx: ReceivingTestContext;
  let server: any;
  let admin: string;
  let ridSeq = 0;
  const rid = (tag: string) => `recv-rid-${tag}-${++ridSeq}`;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** 工具：创建到货单 → 送检 → IQC（返回各步响应） */
  async function arriveAndInspect(opts: {
    tag: string;
    poNo: string;
    materialCode: string;
    qty: number;
    scannedQty?: number;
    labelQty?: number;
    workOrderId?: string;
    iqc: any;
  }) {
    const arr = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(admin))
      .set('X-Request-Id', rid(`${opts.tag}-arr`))
      .send({
        poNo: opts.poNo,
        materialCode: opts.materialCode,
        qty: opts.qty,
        scannedQty: opts.scannedQty ?? 0,
        labelQty: opts.labelQty,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        workOrderId: opts.workOrderId,
      });
    expect(arr.status).toBe(201);

    const insp = await request(server)
      .post(`/api/receiving/${arr.body.id}/send-inspect`)
      .set(auth(admin))
      .set('X-Request-Id', rid(`${opts.tag}-insp`))
      .send({});
    expect(insp.status).toBe(201);
    expect(insp.body.status).toBe('INSPECTING');

    const iqc = await request(server)
      .post(`/api/receiving/${arr.body.id}/iqc`)
      .set(auth(admin))
      .set('X-Request-Id', rid(`${opts.tag}-iqc`))
      .send(opts.iqc);
    return { arrival: arr.body, iqc };
  }

  beforeAll(async () => {
    ctx = await createReceivingTestApp();
    server = ctx.server;
    admin = ctx.adminToken;

    // 从 Mock U8 同步采购订单（重复拉取幂等）
    const sync1 = await request(server)
      .post('/api/receiving/orders/sync')
      .set(auth(admin))
      .send({});
    expect(sync1.status).toBe(201);
    const sync2 = await request(server)
      .post('/api/receiving/orders/sync')
      .set(auth(admin))
      .send({});
    expect(sync2.body.synced).toBe(sync1.body.synced);

    // 测试专用订单：大额普通单 + 委外单（直接落库，模拟 U8 侧数据）
    const poRepo = ctx.ds.getRepository(RcvPurchaseOrder);
    const lineRepo = ctx.ds.getRepository(RcvPurchaseOrderLine);
    await poRepo.save([
      poRepo.create({ poNo: 'PO-TEST-5000', supplierCode: 'SUP001', orderType: PoOrderType.NORMAL, status: 'OPEN' }),
      poRepo.create({ poNo: 'PO-OUT-001', supplierCode: 'SUP002', orderType: PoOrderType.OUTSOURCE, status: 'OPEN' }),
    ]);
    await lineRepo.save([
      lineRepo.create({ poNo: 'PO-TEST-5000', materialCode: 'M-2001', qty: 5000, receivedQty: 0, unit: 'M' }),
      lineRepo.create({ poNo: 'PO-OUT-001', materialCode: 'M-1002', qty: 300, receivedQty: 0, unit: 'PCS' }),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('① 三步链完整走完 → 库存 QUALIFIED 增加、同步任务 SYNCED、批次号规则与标签正确', async () => {
    // 扫码解析 + ABC 提示（M-1002 为 B 类 → 抽查）
    const scan = await request(server)
      .post('/api/receiving/scan')
      .set(auth(admin))
      .send({ barcode: 'PO20260720-001|M-1002|200|SUP001|20260723' });
    expect(scan.status).toBe(201);
    expect(scan.body.poNo).toBe('PO20260720-001');
    expect(scan.body.materialCode).toBe('M-1002');
    expect(scan.body.abcClass).toBe('B');
    expect(scan.body.countMode).toBe('SAMPLE');
    expect(scan.body.countHint).toContain('抽查');

    const orders = await request(server).get('/api/receiving/orders').set(auth(admin));
    const po = orders.body.find((o: any) => o.poNo === 'PO20260720-001');
    expect(po.lines.length).toBe(2);

    const { arrival, iqc } = await arriveAndInspect({
      tag: 't1',
      poNo: 'PO20260720-001',
      materialCode: 'M-1002',
      qty: 200,
      scannedQty: 200,
      labelQty: 200,
      iqc: { decision: 'ALL', qualifiedQty: 200 },
    });
    expect(arrival.status).toBe('ARRIVED');
    expect(arrival.packageNo).toMatch(/^PKG\d{8}-\d{4}$/);
    expect(arrival.batchNo).toMatch(/^LOT-\d{8}-SUP001-\d{4}$/);
    expect(arrival.label).toMatchObject({
      packageNo: arrival.packageNo,
      poNo: 'PO20260720-001',
      materialCode: 'M-1002',
      batchNo: arrival.batchNo,
      qty: 200,
    });
    expect(iqc.status).toBe(201);
    expect(iqc.body.status).toBe('INSPECTED');

    const confirm = await request(server)
      .post(`/api/receiving/${arrival.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t1-cfm'))
      .send({});
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('CONFIRMED');
    expect(confirm.body.syncStatus).toBe('SYNCED');
    expect(confirm.body.postings).toHaveLength(1);
    expect(confirm.body.postings[0]).toMatchObject({ qty: 200, status: 'QUALIFIED', concession: false });

    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-1002&status=QUALIFIED')
      .set(auth(admin));
    const lot = lots.body.find((l: any) => l.packageNo === arrival.packageNo);
    expect(lot).toBeDefined();
    expect(lot.qty).toBe(200);
    expect(lot.batchNo).toBe(arrival.batchNo);

    const syncLogs = await request(server).get('/api/integration/logs').set(auth(admin));
    const task = syncLogs.body.find((t: any) => t.bizKey === arrival.arrivalNo);
    expect(task.status).toBe('SYNCED');

    // 暂存给补打测试复用
    t1Arrival = arrival;
  });

  let t1Arrival: any;

  it('② 部分接收：数量不守恒报错；到货2000 合格200 → QUALIFIED 200 + ISOLATED 1800 + NCR', async () => {
    const arr = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(admin))
      .set('X-Request-Id', rid('t2-arr'))
      .send({
        poNo: 'PO-TEST-5000',
        materialCode: 'M-2001',
        qty: 2000,
        labelQty: 2000,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
      });
    expect(arr.status).toBe(201);
    expect(arr.body.countMode).toBe('LABEL'); // C 类按标签计数

    await request(server)
      .post(`/api/receiving/${arr.body.id}/send-inspect`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t2-insp'))
      .send({});

    // 数量不守恒：200+1700 ≠ 2000 → 报错
    const bad = await request(server)
      .post(`/api/receiving/${arr.body.id}/iqc`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t2-iqc-bad'))
      .send({ decision: 'PARTIAL', qualifiedQty: 200, rejectedQty: 1700, defectDescription: '外观划伤' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('QTY_NOT_CONSERVED');

    const iqc = await request(server)
      .post(`/api/receiving/${arr.body.id}/iqc`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t2-iqc'))
      .send({ decision: 'PARTIAL', qualifiedQty: 200, rejectedQty: 1800, defectDescription: '外观划伤' });
    expect(iqc.status).toBe(201);
    expect(iqc.body.ncrReport).toBeDefined();
    expect(iqc.body.ncrReport.qty).toBe(1800);
    expect(iqc.body.ncrReport.notifyRoles).toContain('MRB');

    const confirm = await request(server)
      .post(`/api/receiving/${arr.body.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t2-cfm'))
      .send({});
    expect(confirm.status).toBe(201);
    const q = confirm.body.postings.find((p: any) => p.status === 'QUALIFIED');
    const iso = confirm.body.postings.find((p: any) => p.status === 'ISOLATED');
    expect(q.qty).toBe(200);
    expect(iso.qty).toBe(1800);

    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-2001')
      .set(auth(admin));
    const qLot = lots.body.find((l: any) => l.packageNo === q.packageNo);
    const isoLot = lots.body.find((l: any) => l.packageNo === iso.packageNo);
    expect(qLot.status).toBe('QUALIFIED');
    expect(qLot.qty).toBe(200);
    expect(isoLot.status).toBe('ISOLATED');
    expect(isoLot.qty).toBe(1800);
  });

  it('③ 特采：无 MRB 会签入库被拒 → 双审批通过 → 入库成功且批次打 concession 标', async () => {
    const { arrival, iqc } = await arriveAndInspect({
      tag: 't3',
      poNo: 'PO-TEST-5000',
      materialCode: 'M-2001',
      qty: 100,
      labelQty: 100,
      iqc: { decision: 'CONCESSION', concessionQty: 100, defectDescription: '尺寸超差但可使用' },
    });
    expect(iqc.status).toBe(201);
    expect(iqc.body.approvalId).toBeGreaterThan(0);
    expect(iqc.body.ncrReport.qty).toBe(100);
    const approvalId = iqc.body.approvalId;

    // 无审批直接入库 → 拒
    const denied = await request(server)
      .post(`/api/receiving/${arrival.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t3-cfm-denied'))
      .send({});
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe('CONCESSION_APPROVAL_REQUIRED');

    // MRB 电子会签：质量负责人(QE) + 授权管理人员(WH_MANAGER)，记录审批人/时间
    const engine = ctx.app.get(ApprovalEngineService);
    await engine.approve(approvalId, 'qe-leader', ['QE'], '同意特采');
    const done = await engine.approve(approvalId, 'wh-director', ['WH_MANAGER'], '同意特采');
    expect(done.status).toBe(ApprovalStatus.APPROVED);
    const steps = JSON.parse(done.steps);
    expect(steps[0].actedBy).toBe('qe-leader');
    expect(steps[0].actedAt).toBeTruthy();
    expect(steps[1].actedBy).toBe('wh-director');

    // 审批通过 → 入库成功
    const confirm = await request(server)
      .post(`/api/receiving/${arrival.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t3-cfm'))
      .send({});
    expect(confirm.status).toBe(201);
    expect(confirm.body.postings[0]).toMatchObject({ qty: 100, status: 'QUALIFIED', concession: true });

    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-2001&status=QUALIFIED')
      .set(auth(admin));
    const lot = lots.body.find((l: any) => l.packageNo === confirm.body.postings[0].packageNo);
    expect(lot.qty).toBe(100);
    expect(lot.sourceDocNo).toBe(arrival.arrivalNo);
  });

  it('④ A 类物料未扫满订单数 → 确认被拒（ABC_COUNT_INCOMPLETE）', async () => {
    const scan = await request(server)
      .post('/api/receiving/scan')
      .set(auth(admin))
      .send({ barcode: 'PO20260720-001|M-1001|500|SUP001|20260723' });
    expect(scan.body.abcClass).toBe('A');
    expect(scan.body.countMode).toBe('FULL');

    const { arrival, iqc } = await arriveAndInspect({
      tag: 't4',
      poNo: 'PO20260720-001',
      materialCode: 'M-1001',
      qty: 500,
      scannedQty: 499, // 少扫 1
      iqc: { decision: 'ALL', qualifiedQty: 500 },
    });
    expect(arrival.countMode).toBe('FULL');
    expect(iqc.status).toBe(201);

    const confirm = await request(server)
      .post(`/api/receiving/${arrival.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t4-cfm'))
      .send({});
    expect(confirm.status).toBe(400);
    expect(confirm.body.code).toBe('ABC_COUNT_INCOMPLETE');
  });

  it('⑤ 委外订单（orderType=OUTSOURCE）入库带委外标识 + 工序发料提醒', async () => {
    const { arrival, iqc } = await arriveAndInspect({
      tag: 't5',
      poNo: 'PO-OUT-001',
      materialCode: 'M-1002',
      qty: 300,
      scannedQty: 300,
      labelQty: 300,
      workOrderId: 'WO20260724-001',
      iqc: { decision: 'ALL', qualifiedQty: 300 },
    });
    expect(arrival.isOutsource).toBe(true);
    expect(iqc.status).toBe(201);

    const confirm = await request(server)
      .post(`/api/receiving/${arrival.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t5-cfm'))
      .send({});
    expect(confirm.status).toBe(201);
    expect(confirm.body.workOrderIssueReminder).toBe(true);
    expect(confirm.body.postings[0]).toMatchObject({
      isOutsource: true,
      sourcePoNo: 'PO-OUT-001',
      supplierCode: 'SUP002',
    });
  });

  it('⑥ 重复 requestId 不产生重复收料单/重复包装号/重复入库', async () => {
    const body = {
      poNo: 'PO-TEST-5000',
      materialCode: 'M-2001',
      qty: 50,
      labelQty: 50,
      warehouseCode: 'WH01',
      locationCode: 'WH01-A-01',
    };
    const first = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(admin))
      .set('X-Request-Id', 'recv-rid-idem-arrival')
      .send(body);
    expect(first.status).toBe(201);
    const second = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(admin))
      .set('X-Request-Id', 'recv-rid-idem-arrival')
      .send(body);
    expect(second.status).toBe(201);
    expect(second.body.arrivalNo).toBe(first.body.arrivalNo);
    expect(second.body.packageNo).toBe(first.body.packageNo);

    const arrivals = await request(server)
      .get('/api/receiving/arrivals?status=ARRIVED')
      .set(auth(admin));
    const dup = arrivals.body.filter((a: any) => a.arrivalNo === first.body.arrivalNo);
    expect(dup).toHaveLength(1);

    // 走完判定后同 requestId 确认两次 → 不重复入库
    await request(server)
      .post(`/api/receiving/${first.body.id}/send-inspect`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t6-insp'))
      .send({});
    await request(server)
      .post(`/api/receiving/${first.body.id}/iqc`)
      .set(auth(admin))
      .set('X-Request-Id', rid('t6-iqc'))
      .send({ decision: 'ALL', qualifiedQty: 50 });
    const c1 = await request(server)
      .post(`/api/receiving/${first.body.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', 'recv-rid-idem-confirm')
      .send({});
    expect(c1.status).toBe(201);
    const c2 = await request(server)
      .post(`/api/receiving/${first.body.id}/confirm`)
      .set(auth(admin))
      .set('X-Request-Id', 'recv-rid-idem-confirm')
      .send({});
    expect(c2.body.arrivalNo).toBe(c1.body.arrivalNo);

    const lots = await request(server)
      .get(`/api/inventory/lots?materialCode=M-2001&status=QUALIFIED`)
      .set(auth(admin));
    const samePkg = lots.body.filter((l: any) => l.packageNo === first.body.packageNo);
    expect(samePkg).toHaveLength(1);
    expect(samePkg[0].qty).toBe(50);
  });

  it('⑦ 标签补打：原因必填，留痕（LabelPrintLog + printCount 累加）', async () => {
    const noReason = await request(server)
      .post('/api/receiving/labels/reprint')
      .set(auth(admin))
      .set('X-Request-Id', rid('t7-nr'))
      .send({ packageNo: t1Arrival.packageNo });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('REPRINT_REASON_REQUIRED');

    const ok = await request(server)
      .post('/api/receiving/labels/reprint')
      .set(auth(admin))
      .set('X-Request-Id', rid('t7-ok'))
      .send({ packageNo: t1Arrival.packageNo, reason: '标签破损' });
    expect(ok.status).toBe(201);
    expect(ok.body.printCount).toBe(2);

    const detail = await request(server)
      .get(`/api/receiving/${t1Arrival.id}`)
      .set(auth(admin));
    expect(detail.body.printCount).toBe(2);
    const types = detail.body.labelLogs.map((l: any) => l.printType);
    expect(types).toEqual(['INITIAL', 'REPRINT']);
    const reprint = detail.body.labelLogs.find((l: any) => l.printType === 'REPRINT');
    expect(reprint.reason).toBe('标签破损');
    expect(reprint.printedBy).toBe('admin');
  });

  it('⑧ 到货单列表、详情与补打均执行仓库数据隔离', async () => {
    const crossActorRequestId = rid('t8-wh02');
    const wh02 = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(admin))
      .set('X-Request-Id', crossActorRequestId)
      .send({
        poNo: 'PO-TEST-5000',
        materialCode: 'M-2001',
        qty: 1,
        scannedQty: 1,
        labelQty: 1,
        warehouseCode: 'WH02',
        locationCode: 'WH02-C-01',
      });
    expect(wh02.status).toBe(201);

    const crossActorReplay = await request(server)
      .post('/api/receiving/arrivals')
      .set(auth(ctx.receiverToken))
      .set('X-Request-Id', crossActorRequestId)
      .send({
        poNo: 'PO-TEST-5000',
        materialCode: 'M-2001',
        qty: 1,
        scannedQty: 1,
        labelQty: 1,
        warehouseCode: 'WH02',
        locationCode: 'WH02-C-01',
      });
    expect(crossActorReplay.status).toBe(403);
    expect(crossActorReplay.body.code).toBe('WAREHOUSE_SCOPE_FORBIDDEN');

    const scopedList = await request(server)
      .get('/api/receiving/arrivals')
      .set(auth(ctx.receiverToken));
    expect(scopedList.status).toBe(200);
    expect(
      scopedList.body.every((arrival: any) => arrival.warehouseCode === 'WH01'),
    ).toBe(true);
    expect(
      scopedList.body.some((arrival: any) => arrival.id === wh02.body.id),
    ).toBe(false);

    const detail = await request(server)
      .get(`/api/receiving/${wh02.body.id}`)
      .set(auth(ctx.receiverToken));
    expect(detail.status).toBe(403);
    expect(detail.body.code).toBe('WAREHOUSE_SCOPE_FORBIDDEN');

    const reprint = await request(server)
      .post('/api/receiving/labels/reprint')
      .set(auth(ctx.receiverToken))
      .set('X-Request-Id', rid('t8-reprint'))
      .send({ packageNo: wh02.body.packageNo, reason: '越权测试' });
    expect(reprint.status).toBe(403);
    expect(reprint.body.code).toBe('WAREHOUSE_SCOPE_FORBIDDEN');
  });
});
