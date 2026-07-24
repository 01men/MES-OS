import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, Module, ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { TEST_ENTITIES } from '../helpers';
import { seedData } from '../../src/seed';
import { GlobalExceptionFilter } from '../../src/common/exceptions';
import { NumberingModule } from '../../src/common/numbering/numbering.module';
import { IdempotencyModule } from '../../src/common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../src/common/idempotency/idempotency.interceptor';
import { AuditModule } from '../../src/common/audit/audit.module';
import { ApprovalModule } from '../../src/common/approval/approval.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { RbacModule } from '../../src/modules/rbac/rbac.module';
import { MasterdataModule } from '../../src/modules/masterdata/masterdata.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { ConfigModule } from '../../src/modules/config/config.module';
import { IntegrationModule } from '../../src/modules/integration/integration.module';
import { SyncService } from '../../src/modules/integration/sync.service';
import { StocktakeModule, STOCKTAKE_ENTITIES } from '../../src/modules/stocktake/stocktake.module';
import { User } from '../../src/modules/rbac/entities/user.entity';
import { Role } from '../../src/modules/rbac/entities/role.entity';
import { StockLot } from '../../src/modules/inventory/entities/stock-lot.entity';
import { StockStatus, DocStatus } from '../../src/common/enums';

/**
 * stocktake 模块 e2e 专用装配（不动 test/helpers.ts 与 app.spec.ts）：
 * 与 src/app.module.ts 自动发现结果等价 + StocktakeModule 静态注册。
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: [...TEST_ENTITIES, ...STOCKTAKE_ENTITIES],
      logging: false,
    } as any),
    NumberingModule,
    IdempotencyModule,
    AuditModule,
    ApprovalModule,
    AuthModule,
    RbacModule,
    MasterdataModule,
    InventoryModule,
    ConfigModule,
    IntegrationModule,
    StocktakeModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class StocktakeTestAppModule {}

describe('stocktake 盘点链 e2e（REQ-018/019/020 + 库龄预警）', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  let adminToken: string;
  let keeperToken: string;
  let manager1Token: string; // WH_MANAGER
  let manager2Token: string; // WH_MANAGER
  let taskA: any; // A 类盲盘任务（M-1001 PKG-INIT-0001 book 500）
  let taskC: any; // C 类明盘任务（M-2001）
  let taskM: any; // 指定物料任务（M-1002，软冻结用）
  let lineA: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (username: string, password: string) => {
    const res = await request(server).post('/api/auth/login').send({ username, password });
    expect(res.status).toBe(201);
    return res.body.token as string;
  };

  beforeAll(async () => {
    app = await NestFactory.create(StocktakeTestAppModule, { logger: false });
    app.setGlobalPrefix('api', {
      exclude: [
        { path: 'mock-u8/purchase-orders', method: RequestMethod.GET },
        { path: 'mock-u8/delivery-notes', method: RequestMethod.GET },
        { path: 'mock-u8/master-data/:type', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    server = app.getHttpServer();
    ds = app.get(DataSource);
    await seedData(ds);
    app.get(SyncService).retryDelaysMs = [5, 10, 15];

    // 仓库主管账号（审批/复盘/过账用，种子仅 admin/receiver01/keeper01）
    const roleRepo = ds.getRepository(Role);
    const userRepo = ds.getRepository(User);
    const mgrRole = await roleRepo.findOne({ where: { code: 'WH_MANAGER' } });
    const hash = await bcrypt.hash('Mgr@123', 10);
    for (const uname of ['manager01', 'manager02']) {
      if (!(await userRepo.findOne({ where: { username: uname } }))) {
        await userRepo.save(
          userRepo.create({ username: uname, name: uname, passwordHash: hash, roles: [mgrRole!], disabled: false }),
        );
      }
    }

    adminToken = await login('admin', 'Admin@123');
    keeperToken = await login('keeper01', 'Keep@123');
    manager1Token = await login('manager01', 'Mgr@123');
    manager2Token = await login('manager02', 'Mgr@123');

    // 阈值与重检周期配置
    await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'stocktake.diffThreshold', value: JSON.stringify({ A: { qty: 5, ratio: 0.02 }, default: { qty: 5, ratio: 0.02 } }) });
    await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'stocktake.reinspectDays', value: JSON.stringify({ 五金: 180, 塑料: 365, default: 270 }) });

    // 补充库存：C 类 M-2001、指定物料 M-1002
    await request(server)
      .post('/api/inventory/inbound')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-setup-in-1')
      .send({ packageNo: 'PKG-STK-C1', materialCode: 'M-2001', batchNo: 'BC1', qty: 200, warehouseCode: 'WH01', locationCode: 'WH01-A-01', sourceDocNo: 'RCV-STK-1' });
    await request(server)
      .post('/api/inventory/inbound')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-setup-in-2')
      .send({ packageNo: 'PKG-STK-M2', materialCode: 'M-1002', batchNo: 'BM2', qty: 100, warehouseCode: 'WH01', locationCode: 'WH01-A-01', sourceDocNo: 'RCV-STK-2' });

    // 库龄预警物料 + 直接落库的历史批次（无流水 → 最近移动=入库日期）
    await request(server)
      .post('/api/masterdata/materials')
      .set(auth(adminToken))
      .send({ materialCode: 'M-9001', name: '五金测试件', safetyStock: 0, unit: 'PCS' });
    await request(server)
      .post('/api/masterdata/materials')
      .set(auth(adminToken))
      .send({ materialCode: 'M-9002', name: '五金旧件', safetyStock: 0, unit: 'PCS' });
    const lotRepo = ds.getRepository(StockLot);
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
    await lotRepo.save(
      lotRepo.create({
        packageNo: 'PKG-AGE-1', materialCode: 'M-9001', batchNo: 'BA1', warehouseCode: 'WH01',
        locationCode: 'WH01-A-01', qty: 10, status: StockStatus.QUALIFIED, workOrderId: null,
        sourceDocNo: 'INIT-AGE-1', receivedAt: daysAgo(120), expiryDate: null,
      }),
    );
    await lotRepo.save(
      lotRepo.create({
        packageNo: 'PKG-AGE-2', materialCode: 'M-9002', batchNo: 'BA2', warehouseCode: 'WH01',
        locationCode: 'WH01-A-01', qty: 5, status: StockStatus.QUALIFIED, workOrderId: null,
        sourceDocNo: 'INIT-AGE-2', receivedAt: daysAgo(200), expiryDate: null,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('① 策略创建 + 任务生成幂等（同日重复生成不重复任务）', async () => {
    const defs = [
      { name: 'A类月盘', scopeType: 'ABC', scopeValue: 'A', cycleDays: 30, ownerUserId: 'keeper01' },
      { name: 'C类半年盘', scopeType: 'ABC', scopeValue: 'C', cycleDays: 180, ownerUserId: 'keeper01' },
      { name: 'M1002专项', scopeType: 'MATERIAL', scopeValue: '["M-1002"]', cycleDays: 30, ownerUserId: 'keeper01' },
    ];
    for (let i = 0; i < defs.length; i++) {
      const res = await request(server)
        .post('/api/stocktake/strategies')
        .set(auth(adminToken))
        .set('X-Request-Id', `stk-rid-strategy-${i}`)
        .send(defs[i]);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
    }
    const list = await request(server).get('/api/stocktake/strategies').set(auth(adminToken));
    expect(list.body).toHaveLength(3);

    const g1 = await request(server)
      .post('/api/stocktake/tasks/generate')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-gen-1')
      .send({});
    expect(g1.status).toBe(201);
    expect(g1.body.created).toHaveLength(3);
    taskA = g1.body.created.find((t: any) => t.blind === true);
    taskC = g1.body.created.find((t: any) => t.blind === false && t.strategyId === 2);
    taskM = g1.body.created.find((t: any) => t.strategyId === 3);
    expect(taskA.taskNo).toMatch(/^STK/);

    // 同日重复生成（不同 requestId）→ 不重复任务
    const g2 = await request(server)
      .post('/api/stocktake/tasks/generate')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-gen-2')
      .send({});
    expect(g2.status).toBe(201);
    expect(g2.body.created).toHaveLength(0);

    const tasks = await request(server).get('/api/stocktake/tasks').set(auth(adminToken));
    expect(tasks.body).toHaveLength(3);

    // 同 requestId 重放 → 返回首次结果
    const g1replay = await request(server)
      .post('/api/stocktake/tasks/generate')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-gen-1')
      .send({});
    expect(g1replay.body.created).toHaveLength(3);
    const tasksAfter = await request(server).get('/api/stocktake/tasks').set(auth(adminToken));
    expect(tasksAfter.body).toHaveLength(3);
  });

  it('② 盲盘任务对初盘人隐藏账面数，明盘返回账面数', async () => {
    const blindForKeeper = await request(server)
      .get(`/api/stocktake/tasks/${taskA.id}`)
      .set(auth(keeperToken));
    expect(blindForKeeper.status).toBe(200);
    expect(blindForKeeper.body.blind).toBe(true);
    expect(blindForKeeper.body.lines).toHaveLength(1);
    expect(blindForKeeper.body.lines[0].bookQty).toBeUndefined();
    expect(blindForKeeper.body.lines[0].diff).toBeUndefined();
    lineA = blindForKeeper.body.lines[0].lineNo;
    expect(lineA).toContain('WH01-A-01');

    // 主管/管理员可见账面数
    const blindForAdmin = await request(server)
      .get(`/api/stocktake/tasks/${taskA.id}`)
      .set(auth(adminToken));
    expect(blindForAdmin.body.lines[0].bookQty).toBe(500);

    // 明盘：初盘人可见账面数
    const openForKeeper = await request(server)
      .get(`/api/stocktake/tasks/${taskC.id}`)
      .set(auth(keeperToken));
    expect(openForKeeper.body.blind).toBe(false);
    expect(openForKeeper.body.lines[0].bookQty).toBe(200);
  });

  it('③ 超阈值差异强制复盘（数量+比例组合阈值）', async () => {
    // 账面 500，实盘 480，差异 -20：> 数量阈值 5 且比例 4% > 2%
    const count = await request(server)
      .post(`/api/stocktake/tasks/${taskA.id}/count`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-count-1')
      .send({ lineNo: lineA, actualQty: 480 });
    expect(count.status).toBe(201);
    expect(count.body.needRecount).toBe(true);
    // 盲盘：初盘人提交响应不回传账面/差异
    expect(count.body.bookQty).toBeUndefined();

    // 未复盘前不允许过账
    const postEarly = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-post-early')
      .send({});
    expect(postEarly.status).toBe(400);
    expect(postEarly.body.code).toBe('RECOUNT_REQUIRED');

    // 复盘必须由第二人执行
    const recountSelf = await request(server)
      .post(`/api/stocktake/tasks/${taskA.id}/recount`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-recount-self')
      .send({ lineNo: lineA, actualQty: 480, reason: '破损 20' });
    expect(recountSelf.status).toBe(400);
    expect(recountSelf.body.code).toBe('RECOUNT_SECOND_PERSON_REQUIRED');

    // 超阈值复盘必须填原因
    const recountNoReason = await request(server)
      .post(`/api/stocktake/tasks/${taskA.id}/recount`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-recount-nr')
      .send({ lineNo: lineA, actualQty: 480 });
    expect(recountNoReason.status).toBe(400);
    expect(recountNoReason.body.code).toBe('REASON_REQUIRED');

    const recount = await request(server)
      .post(`/api/stocktake/tasks/${taskA.id}/recount`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-recount-1')
      .send({ lineNo: lineA, actualQty: 480, reason: '破损 20' });
    expect(recount.status).toBe(201);
    expect(recount.body.diff).toBe(-20);
    expect(recount.body.status).toBe('RECOUNTED');
  });

  it('④ 初盘人员不得自行过账差异', async () => {
    const res = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-post-self')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_POST_FORBIDDEN');
  });

  it('⑤ 唯一行号防重：同任务同物料同批次不得两次提交', async () => {
    const dup = await request(server)
      .post(`/api/stocktake/tasks/${taskA.id}/count`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-count-dup')
      .send({ lineNo: lineA, actualQty: 480 });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('DUPLICATE_COUNT');
  });

  it('⑥ 硬冻结后 FROZEN 批次占用被拒，解冻恢复', async () => {
    const freeze = await request(server)
      .post(`/api/stocktake/${taskA.id}/freeze`)
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-freeze-hard')
      .send({ mode: 'HARD' });
    expect(freeze.status).toBe(201);
    expect(freeze.body.status).toBe('FROZEN');

    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-1001')
      .set(auth(adminToken));
    expect(lots.body[0].status).toBe('FROZEN');

    // FROZEN 不计入可用量 → 占用被拒
    const occupy = await request(server)
      .post('/api/inventory/occupy')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-occupy-1')
      .send({ workOrderId: 'WO-STK-1', items: [{ materialCode: 'M-1001', qty: 400 }], prepDocNo: 'PREP-STK-1' });
    expect(occupy.status).toBe(400);
    expect(occupy.body.code).toBe('INSUFFICIENT_AVAILABLE');

    const unfreeze = await request(server)
      .post(`/api/stocktake/${taskA.id}/unfreeze`)
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-unfreeze-hard')
      .send({});
    expect(unfreeze.status).toBe(201);
    expect(unfreeze.body.restored).toContain('PKG-INIT-0001');

    const lotsAfter = await request(server)
      .get('/api/inventory/lots?materialCode=M-1001')
      .set(auth(adminToken));
    expect(lotsAfter.body[0].status).toBe('QUALIFIED');
  });

  it('⑦ 软冻结审批生效 + 变动隔离记录 + 解冻逐笔对账清单', async () => {
    // 软冻结需审批：仓管员申请，仓库主管审批
    const freeze = await request(server)
      .post(`/api/stocktake/${taskM.id}/freeze`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-freeze-soft')
      .send({ mode: 'SOFT' });
    expect(freeze.status).toBe(201);
    expect(freeze.body.status).toBe('PENDING_APPROVAL');
    const approvalId = freeze.body.approvalId;

    // 审批通过前不允许记隔离变动
    const fmEarly = await request(server)
      .post(`/api/stocktake/${taskM.id}/frozen-movements`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-fm-early')
      .send({ packageNo: 'PKG-STK-M2', movementType: 'CONSUME', qtyChange: -20, docNo: 'PREP-SOFT-1' });
    expect(fmEarly.status).toBe(400);
    expect(fmEarly.body.code).toBe('SOFT_FREEZE_NOT_ACTIVE');

    const approve = await request(server)
      .post(`/api/stocktake/approvals/${approvalId}/approve`)
      .set(auth(manager1Token))
      .send({});
    expect(approve.status).toBe(201);
    expect(approve.body.status).toBe('APPROVED');

    // 冻结期间变动隔离记录 + 真实账同步变动（模拟连续生产出库 20）
    const fm = await request(server)
      .post(`/api/stocktake/${taskM.id}/frozen-movements`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-fm-1')
      .send({ packageNo: 'PKG-STK-M2', movementType: 'CONSUME', qtyChange: -20, docNo: 'PREP-SOFT-1' });
    expect(fm.status).toBe(201);
    const adjust = await request(server)
      .post('/api/inventory/adjust')
      .set(auth(adminToken))
      .set('X-Request-Id', 'stk-rid-adj-soft')
      .send({ packageNo: 'PKG-STK-M2', newQty: 80, reason: '软冻结期间生产出库', docNo: 'PREP-SOFT-1' });
    expect(adjust.status).toBe(201);

    // 解冻：逐笔对账（账面=快照100+变动-20=80 vs 当前 80 → match）
    const unfreeze = await request(server)
      .post(`/api/stocktake/${taskM.id}/unfreeze`)
      .set(auth(keeperToken))
      .set('X-Request-Id', 'stk-rid-unfreeze-soft')
      .send({});
    expect(unfreeze.status).toBe(201);
    expect(unfreeze.body.mode).toBe('SOFT');
    expect(unfreeze.body.reconciliation).toHaveLength(1);
    const rec = unfreeze.body.reconciliation[0];
    expect(rec.snapshotQty).toBe(100);
    expect(rec.movementSum).toBe(-20);
    expect(rec.expectedQty).toBe(80);
    expect(rec.currentQty).toBe(80);
    expect(rec.match).toBe(true);
  });

  it('⑧ 审批后差异过账：available 按新账面 + U8 SYNCED + 三账一致', async () => {
    // 复盘员过账 → 创建审批（仓库主管）
    const post1 = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-post-1')
      .send({});
    expect(post1.status).toBe(201);
    expect(post1.body.status).toBe('PENDING_APPROVAL');
    const approvalId = post1.body.approvalId;

    // 审批中重复调用 → 仍 PENDING
    const post2 = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-post-2')
      .send({});
    expect(post2.body.status).toBe('PENDING_APPROVAL');

    // 申请人不得自审（manager01 是申请人）→ 由 manager02 审批
    const approveSelf = await request(server)
      .post(`/api/stocktake/approvals/${approvalId}/approve`)
      .set(auth(manager1Token))
      .send({});
    expect(approveSelf.status).toBe(400);
    expect(approveSelf.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    const approve = await request(server)
      .post(`/api/stocktake/approvals/${approvalId}/approve`)
      .set(auth(manager2Token))
      .send({ comment: '同意盘亏 20' });
    expect(approve.body.status).toBe('APPROVED');

    // 审批通过 → 执行过账
    const post3 = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-post-3')
      .send({});
    expect(post3.status).toBe(201);
    expect(post3.body.status).toBe('COMPLETED');
    expect(post3.body.posted).toBe(1);
    expect(post3.body.syncStatus).toBe(DocStatus.SYNCED);

    // 台账：available 按新账面（500→480，安全库存 100）
    const avail = await request(server)
      .get('/api/inventory/available/M-1001')
      .set(auth(adminToken));
    expect(avail.body.qualifiedQty).toBe(480);
    expect(avail.body.available).toBe(380);

    // 调整单：U8 同步 SYNCED，payload 差异 -20
    const logs = await request(server).get('/api/integration/logs').set(auth(adminToken));
    const syncTask = logs.body.find((t: any) => t.bizKey === `STKADJ-${taskA.taskNo}`);
    expect(syncTask).toBeDefined();
    expect(syncTask.status).toBe(DocStatus.SYNCED);
    const payload = JSON.parse(syncTask.payload);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].diff).toBe(-20);

    // 报告：三账一致（报告差异 = 调整单差异 = 台账变动 500→480）
    const report = await request(server)
      .get(`/api/stocktake/${taskA.id}/report`)
      .set(auth(adminToken));
    expect(report.status).toBe(200);
    expect(report.body.totals.diff).toBe(-20);
    expect(report.body.totals.bookQty).toBe(500);
    expect(report.body.totals.actualQty).toBe(480);
    expect(report.body.totals.diffRate).toBeCloseTo(-0.04, 5);
    expect(report.body.lines[0].reason).toBe('破损 20');
    expect(report.body.lines[0].postedQty).toBe(480);
    expect(report.body.consistency.consistent).toBe(true);
    expect(report.body.summary.byArea[0].diff).toBe(-20);
    expect(report.body.summary.byAbcClass[0].key).toBe('A');
    expect(report.body.summary.byOwner[0].key).toBe('keeper01');

    // 重复过账幂等：不再重复 adjust / 重复 U8 单据
    const postAgain = await request(server)
      .post(`/api/stocktake/${taskA.id}/post-adjustments`)
      .set(auth(manager1Token))
      .set('X-Request-Id', 'stk-rid-post-4')
      .send({});
    expect(postAgain.body.posted).toBe(0);
    const logs2 = await request(server).get('/api/integration/logs').set(auth(adminToken));
    expect(logs2.body.filter((t: any) => t.bizKey === `STKADJ-${taskA.taskNo}`)).toHaveLength(1);
  });

  it('⑨ 库龄：连续 3 个月无移动 → 预警；达重检周期 → 到期重检', async () => {
    const res = await request(server).get('/api/stocktake/aging').set(auth(adminToken));
    expect(res.status).toBe(200);
    const warn = res.body.find((r: any) => r.materialCode === 'M-9001');
    expect(warn).toBeDefined();
    expect(warn.daysSinceMove).toBeGreaterThanOrEqual(119);
    expect(warn.level).toBe('WARN_3M');

    const due = res.body.find((r: any) => r.materialCode === 'M-9002');
    expect(due).toBeDefined();
    expect(due.reinspectDays).toBe(180); // 五金类差异化重检周期
    expect(due.level).toBe('REINSPECT_DUE');

    // 正常流动批次不预警
    const normal = res.body.find((r: any) => r.packageNo === 'PKG-STK-M2');
    expect(normal.level).toBe('NONE');
  });
});
