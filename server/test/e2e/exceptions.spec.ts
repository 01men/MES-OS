import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, Module, ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { OfflineModule } from '../../src/modules/offline/offline.module';
import { IntegrationModule } from '../../src/modules/integration/integration.module';
import { SyncService } from '../../src/modules/integration/sync.service';
import { Role } from '../../src/modules/rbac/entities/role.entity';
import { User } from '../../src/modules/rbac/entities/user.entity';
import { Material } from '../../src/modules/masterdata/entities/material.entity';
import { WorkOrder } from '../../src/modules/masterdata/entities/work-order.entity';
import { Bom } from '../../src/modules/masterdata/entities/bom.entity';
import { SURPLUS_ENTITIES, SurplusModule } from '../../src/modules/surplus/surplus.module';
import { TRANSFER_ENTITIES, TransferModule } from '../../src/modules/transfer/transfer.module';
import { RETURNS_ENTITIES, ReturnsModule } from '../../src/modules/returns/returns.module';

/** 异常物料链测试实体清单 = 共享清单 + 三模块实体（不改 test/helpers.ts） */
const EXC_TEST_ENTITIES = [
  ...TEST_ENTITIES,
  ...SURPLUS_ENTITIES,
  ...TRANSFER_ENTITIES,
  ...RETURNS_ENTITIES,
];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: EXC_TEST_ENTITIES,
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
    OfflineModule,
    IntegrationModule,
    SurplusModule,
    TransferModule,
    ReturnsModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class ExceptionsTestAppModule {}

describe('异常物料链 e2e（surplus/transfer/returns）', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  const tokens: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (username: string, password: string) => {
    const res = await request(server).post('/api/auth/login').send({ username, password });
    expect(res.status).toBe(201);
    return res.body.token as string;
  };

  beforeAll(async () => {
    app = await NestFactory.create(ExceptionsTestAppModule, { logger: false });
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

    // ---- 测试化角色与用户（本文件自建 setup，不改共享 seed） ----
    const roleRepo = ds.getRepository(Role);
    if (!(await roleRepo.findOne({ where: { code: 'WORKSHOP_DIRECTOR' } }))) {
      await roleRepo.save(
        roleRepo.create({ code: 'WORKSHOP_DIRECTOR', name: '车间主任', permissions: [] }),
      );
    }
    const userRepo = ds.getRepository(User);
    const ensureUser = async (username: string, roleCodes: string[]) => {
      if (await userRepo.findOne({ where: { username } })) return;
      const roles = await roleRepo.find({ where: roleCodes.map((code) => ({ code })) as any });
      await userRepo.save(
        userRepo.create({
          username,
          name: username,
          passwordHash: await bcrypt.hash('Test@123', 10),
          roles,
          disabled: false,
        }),
      );
    };
    await ensureUser('leader01', ['LEADER']);
    await ensureUser('whm01', ['WH_MANAGER']);
    await ensureUser('qe01', ['QE']);
    await ensureUser('insp01', ['INSPECTOR']);
    await ensureUser('fin01', ['FINANCE']);
    await ensureUser('pmc01', ['PMC']);
    await ensureUser('dir01', ['WORKSHOP_DIRECTOR']);

    // ---- 测试物料 / 工单 / BOM ----
    const matRepo = ds.getRepository(Material);
    for (const m of [
      { materialCode: 'M-SUR', name: '余料测试件', safetyStock: 0, unit: 'PCS', isSpecial: false, specialStatus: 'NORMAL' },
      { materialCode: 'M-GEN', name: '通用件', safetyStock: 0, unit: 'PCS', isSpecial: false, specialStatus: 'NORMAL' },
      { materialCode: 'M-SPC', name: '专用件未确认', safetyStock: 0, unit: 'PCS', isSpecial: true, specialStatus: 'PENDING' },
    ]) {
      if (!(await matRepo.findOne({ where: { materialCode: m.materialCode } }))) {
        await matRepo.save(matRepo.create(m as any));
      }
    }
    const woRepo = ds.getRepository(WorkOrder);
    for (const w of [
      { workOrderId: 'WO-A', productCode: 'P-A', planQty: 100 },
      { workOrderId: 'WO-B', productCode: 'P-A', planQty: 100 },
      { workOrderId: 'WO-C', productCode: 'P-A', planQty: 100 },
    ]) {
      if (!(await woRepo.findOne({ where: { workOrderId: w.workOrderId } }))) {
        await woRepo.save(woRepo.create({ ...w, planDate: '2026-07-25', status: 'RELEASED' }));
      }
    }
    const bomRepo = ds.getRepository(Bom);
    if (!(await bomRepo.findOne({ where: { bomCode: 'BOM-A' } }))) {
      await bomRepo.save(
        bomRepo.create({
          bomCode: 'BOM-A',
          productCode: 'P-A',
          version: 1,
          items: [
            { bomCode: 'BOM-A', materialCode: 'M-GEN', qty: 1, unit: 'PCS' },
            { bomCode: 'BOM-A', materialCode: 'M-SPC', qty: 1, unit: 'PCS' },
          ] as any,
        }),
      );
    }

    tokens.admin = await login('admin', 'Admin@123');
    tokens.leader = await login('leader01', 'Test@123');
    tokens.whm = await login('whm01', 'Test@123');
    tokens.qe = await login('qe01', 'Test@123');
    tokens.insp = await login('insp01', 'Test@123');
    tokens.fin = await login('fin01', 'Test@123');
    tokens.pmc = await login('pmc01', 'Test@123');
    tokens.dir = await login('dir01', 'Test@123');

    // 库存准备
    const inbound = (packageNo: string, materialCode: string, qty: number, rid: string) =>
      request(server)
        .post('/api/inventory/inbound')
        .set(auth(tokens.admin))
        .set('X-Request-Id', rid)
        .send({
          packageNo,
          materialCode,
          batchNo: `B-${packageNo}`,
          qty,
          warehouseCode: 'WH01',
          locationCode: 'WH01-A-01',
          sourceDocNo: 'RCV-EXC-SETUP',
        });
    expect((await inbound('PKG-S1', 'M-SUR', 100, 'exc-in-s1')).status).toBe(201);
    expect((await inbound('PKG-S2', 'M-SUR', 50, 'exc-in-s2')).status).toBe(201);
    expect((await inbound('PKG-T1', 'M-SPC', 100, 'exc-in-t1')).status).toBe(201);
    expect((await inbound('PKG-R1', 'M-GEN', 500, 'exc-in-r1')).status).toBe(201);
    expect((await inbound('PKG-W1', 'M-GEN', 200, 'exc-in-w1')).status).toBe(201);
    expect((await inbound('PKG-Q1', 'M-GEN', 80, 'exc-in-q1')).status).toBe(201);

    // 超领阈值 10%
    const rule = await request(server)
      .post('/api/config/rules')
      .set(auth(tokens.admin))
      .send({ key: 'returns.overIssueRate', value: '0.1' });
    expect(rule.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // ① 余料入 YL 后 available 不变、总库存平衡；提醒/打印/处理
  it('① 余料登记入 YL：available 不计余料、库存平衡、提醒/打印/部分处理关闭', async () => {
    const before = await request(server).get('/api/inventory/available/M-SUR').set(auth(tokens.admin));
    expect(before.body.available).toBe(150); // 100 + 50，无占用无安全库存

    const occurredAt = new Date(Date.now() - 16 * 86400000).toISOString();
    const reg = await request(server)
      .post('/api/surplus')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-reg-1')
      .send({
        packageNo: 'PKG-S1',
        sourceType: 'WORK_ORDER_LEFT',
        sourceDocNo: 'WO-A',
        responsible: '张三',
        occurredAt,
      });
    expect(reg.status).toBe(201);
    expect(reg.body.docNo).toMatch(/^SUR/);
    expect(reg.body.qty).toBe(100);
    expect(reg.body.status).toBe('OPEN');

    // 幂等重放：同 X-Request-Id 不重复登记
    const replay = await request(server)
      .post('/api/surplus')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-reg-1')
      .send({
        packageNo: 'PKG-S1',
        sourceType: 'WORK_ORDER_LEFT',
        sourceDocNo: 'WO-A',
        responsible: '张三',
        occurredAt,
      });
    expect(replay.body.docNo).toBe(reg.body.docNo);

    // available 减少（余料不计入正常可用库存），总实物不变（平衡）
    const after = await request(server).get('/api/inventory/available/M-SUR').set(auth(tokens.admin));
    expect(after.body.available).toBe(50);
    const lots = await request(server).get('/api/inventory/lots?materialCode=M-SUR').set(auth(tokens.admin));
    const totalQty = lots.body.reduce((s: number, l: any) => s + l.qty, 0);
    expect(totalQty).toBe(150); // 调拨前后总库存平衡
    const yl = lots.body.find((l: any) => l.packageNo === 'PKG-S1');
    expect(yl.status).toBe('SURPLUS_YL');
    expect(yl.locationCode).toBe('WH01-YL-01');

    // from-leftover（prep leftoverReminder 场景）
    const lo = await request(server)
      .post('/api/surplus/from-leftover')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-lo-1')
      .send({ packageNo: 'PKG-S2', prepDocNo: 'PREP-LEFT-1', responsible: '李四', workOrderId: 'WO-A', occurredAt });
    expect(lo.status).toBe(201);
    expect(lo.body.sourceType).toBe('PREP_LEFTOVER');

    // 提醒：16 天前产生 → [3,7,15] 三条，来源工单 → PMC
    const scanRes = await request(server).post('/api/surplus/reminders/scan').set(auth(tokens.admin));
    expect(scanRes.status).toBe(201);
    const reminders = await request(server)
      .get('/api/surplus/reminders?status=PENDING')
      .set(auth(tokens.admin));
    const mine = reminders.body.filter((r: any) => r.docNo === reg.body.docNo);
    expect(mine).toHaveLength(3);
    expect(mine.map((r: any) => r.remindDay).sort((a: number, b: number) => a - b)).toEqual([3, 7, 15]);
    expect(mine[0].targetRole).toBe('WH_MANAGER'); // 无来源工单 → 仓库主管
    const loReminders = reminders.body.filter((r: any) => r.docNo === lo.body.docNo);
    expect(loReminders[0].targetRole).toBe('PMC'); // 有来源工单 → PMC
    // 重复扫描不重复生成
    const scan2 = await request(server).post('/api/surplus/reminders/scan').set(auth(tokens.admin));
    expect(scan2.body).toHaveLength(0);

    // 标签打印/补打留痕
    const p1 = await request(server).post(`/api/surplus/${reg.body.id}/print`).set(auth(tokens.admin));
    expect(p1.body.printType).toBe('PRINT');
    expect(p1.body.label.materialCode).toBe('M-SUR');
    expect(p1.body.label.sourceDocNo).toBe('WO-A');
    const p2 = await request(server).post(`/api/surplus/${reg.body.id}/print`).set(auth(tokens.admin));
    expect(p2.body.printType).toBe('REPRINT');

    // 部分处理（退供应商）：余额保留、提醒保留
    const proc1 = await request(server)
      .post(`/api/surplus/${reg.body.id}/process`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-proc-1')
      .send({ method: 'RETURN_SUPPLIER', qty: 40 });
    expect(proc1.status).toBe(201);
    expect(proc1.body.record.qty).toBe(60);
    expect(proc1.body.record.status).toBe('OPEN');
    // 正常库存不反向增加
    const avail2 = await request(server).get('/api/inventory/available/M-SUR').set(auth(tokens.admin));
    expect(avail2.body.qualifiedQty).toBe(0);
    // 退货单走 SyncService
    const syncLogs = await request(server).get('/api/integration/logs').set(auth(tokens.admin));
    expect(syncLogs.body.some((t: any) => t.bizKey === proc1.body.process.docNo && t.voucherType === 'RETURN_SUPPLIER')).toBe(true);

    // 超量处理被拒
    const tooMuch = await request(server)
      .post(`/api/surplus/${reg.body.id}/process`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-proc-x')
      .send({ method: 'RETURN_SUPPLIER', qty: 999 });
    expect(tooMuch.body.code).toBe('SURPLUS_QTY_EXCEED');

    // 余额为 0 才关闭
    const proc2 = await request(server)
      .post(`/api/surplus/${reg.body.id}/process`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-sur-proc-2')
      .send({ method: 'RETURN_SUPPLIER', qty: 60 });
    expect(proc2.body.record.qty).toBe(0);
    expect(proc2.body.record.status).toBe('CLOSED');
  });

  // ② 专用件挪料：无审批被拒 → 班组长审批 → 占用转移成功
  let spcTransferId: number;
  it('② 专用件挪料须班组长审批，过账后占用转移', async () => {
    // WO-A 占用 M-SPC 60
    const occ = await request(server)
      .post('/api/inventory/occupy')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-occ-spc-1')
      .send({ workOrderId: 'WO-A', items: [{ materialCode: 'M-SPC', qty: 60 }], prepDocNo: 'PREP-A1' });
    expect(occ.status).toBe(201);

    const tr = await request(server)
      .post('/api/transfer')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-tr-spc-1')
      .send({ sourceWorkOrderId: 'WO-A', targetWorkOrderId: 'WO-B', materialCode: 'M-SPC', batchNo: 'B-PKG-T1', qty: 30 });
    expect(tr.status).toBe(201);
    expect(tr.body.needApproval).toBe(true);
    expect(tr.body.status).toBe('PENDING_APPROVAL');
    spcTransferId = tr.body.id;

    // 未审批过账被拒
    const postEarly = await request(server)
      .post(`/api/transfer/${spcTransferId}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-tr-spc-post-0');
    expect(postEarly.body.code).toBe('NOT_APPROVED');

    // 自审被拒（审批引擎硬约束）
    const selfApprove = await request(server)
      .post(`/api/transfer/${spcTransferId}/approve`)
      .set(auth(tokens.admin));
    expect(selfApprove.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    // 非班组长无权审批
    const wrongRole = await request(server)
      .post(`/api/transfer/${spcTransferId}/approve`)
      .set(auth(tokens.pmc));
    expect(wrongRole.body.code).toBe('NOT_CURRENT_APPROVER');

    // 班组长审批 → 过账
    const ok = await request(server)
      .post(`/api/transfer/${spcTransferId}/approve`)
      .set(auth(tokens.leader));
    expect(ok.status).toBe(201);
    const posted = await request(server)
      .post(`/api/transfer/${spcTransferId}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-tr-spc-post-1');
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.approver).toBe('leader01');
    expect(posted.body.postedAt).toBeTruthy();

    // 占用转移：WO-A 30 / WO-B 30；available 不变（占用总量不变）
    const batches = await request(server)
      .get('/api/transfer/batches?materialCode=M-SPC')
      .set(auth(tokens.admin));
    const occs = batches.body.occupations;
    expect(occs.find((o: any) => o.workOrderId === 'WO-A')?.qty).toBe(30);
    expect(occs.find((o: any) => o.workOrderId === 'WO-B')?.qty).toBe(30);
    const avail = await request(server).get('/api/inventory/available/M-SPC').set(auth(tokens.admin));
    expect(avail.body.available).toBe(40); // 100 - 60 占用
  });

  // ③ 已消耗数量挪用被拒
  it('③ 已实际消耗数量不得挪用', async () => {
    // 交接出库：WO-A 剩余 ACTIVE 30 全部核销
    const consume = await request(server)
      .post('/api/inventory/consume')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-consume-a1')
      .send({ prepDocNo: 'PREP-A1' });
    expect(consume.status).toBe(201);

    // WO-A 已无 ACTIVE 占用（仅剩 CONSUMED），挪用被拒
    const tr = await request(server)
      .post('/api/transfer')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-tr-consumed-1')
      .send({ sourceWorkOrderId: 'WO-A', targetWorkOrderId: 'WO-C', materialCode: 'M-SPC', qty: 1 });
    expect(tr.body.code).toBe('TRANSFER_EXCEED');
  });

  // ④ 超领触发审批、超退超上限被拒（无原因）
  it('④ 超领触发车间主任审批（OVR 编号）、超退超上限强制原因+审批', async () => {
    // WO-A 领 M-GEN 100 = BOM 计划 100
    const occ = await request(server)
      .post('/api/inventory/occupy')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-occ-gen-1')
      .send({ workOrderId: 'WO-A', items: [{ materialCode: 'M-GEN', qty: 100 }], prepDocNo: 'PREP-R1' });
    expect(occ.status).toBe(201);

    // 直接补料 20：100+20 > 100×1.1 → 超领，OVR 编号 + 待审批
    const rep = await request(server)
      .post('/api/returns/replenish')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-over-1')
      .send({ type: 'DIRECT', workOrderId: 'WO-A', materialCode: 'M-GEN', qty: 20 });
    expect(rep.status).toBe(201);
    expect(rep.body.isOver).toBe(true);
    expect(rep.body.docNo).toMatch(/^OVR/);
    expect(rep.body.status).toBe('PENDING_APPROVAL');

    // 未审批过账被拒；车间主任审批后过账
    const postEarly = await request(server)
      .post(`/api/returns/replenish/${rep.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-over-post-0');
    expect(postEarly.body.code).toBe('NOT_APPROVED');
    const ok = await request(server)
      .post(`/api/returns/replenish/${rep.body.id}/approve`)
      .set(auth(tokens.dir));
    expect(ok.status).toBe(201);
    const posted = await request(server)
      .post(`/api/returns/replenish/${rep.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-over-post-1');
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');

    // 阈值内补料无需审批：WO-C 补 10 ≤ 100×1.1
    const repOk = await request(server)
      .post('/api/returns/replenish')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-ok-1')
      .send({ type: 'DIRECT', workOrderId: 'WO-C', materialCode: 'M-GEN', qty: 10 });
    expect(repOk.body.isOver).toBe(false);
    expect(repOk.body.docNo).toMatch(/^RTN/);
    expect(repOk.body.status).toBe('POSTED');

    // 超退：WO-A 可退上限 = 120 - 0 - 0 = 120；退 200 且无原因 → 被拒
    const overNoReason = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-over-0')
      .send({ type: 'NORMAL', workOrderId: 'WO-A', materialCode: 'M-GEN', qty: 200 });
    expect(overNoReason.body.code).toBe('OVER_RETURN_REASON_REQUIRED');

    // 填原因 → OVR 编号 + 仓库主管审批
    const over = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-over-1')
      .send({ type: 'NORMAL', workOrderId: 'WO-A', materialCode: 'M-GEN', qty: 200, reason: '工单取消余料退回' });
    expect(over.status).toBe(201);
    expect(over.body.isOver).toBe(true);
    expect(over.body.docNo).toMatch(/^OVR/);
    expect(over.body.status).toBe('PENDING_APPROVAL');
    const okRet = await request(server)
      .post(`/api/returns/${over.body.id}/approve`)
      .set(auth(tokens.whm));
    expect(okRet.status).toBe(201);
    const postedRet = await request(server)
      .post(`/api/returns/${over.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-over-post-1');
    expect(postedRet.body.status).toBe('POSTED');

    // 限额内正常退料无需审批（WO-C 已领 10、未消耗、未退 → 上限 10）
    const normal = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-ok-1')
      .send({ type: 'NORMAL', workOrderId: 'WO-C', materialCode: 'M-GEN', qty: 10 });
    expect(normal.body.isOver).toBe(false);
    expect(normal.body.docNo).toMatch(/^RTN/);
    expect(normal.body.status).toBe('POSTED');

    // OVR 单据单独统计
    const overs = await request(server).get('/api/returns?isOver=true').set(auth(tokens.admin));
    expect(overs.body.length).toBeGreaterThanOrEqual(1);
    expect(overs.body.every((r: any) => r.docNo.startsWith('OVR'))).toBe(true);
  });

  // ⑤ 不良退料无不良记录被拒
  let defectReturnDocNo: string;
  it('⑤ 不良退料必须关联已审批且数量足够的不良记录', async () => {
    // 无 defectDocNo → 拒
    const noDoc = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-def-0')
      .send({ type: 'DEFECT', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 5 });
    expect(noDoc.body.code).toBe('DEFECT_RECORD_REQUIRED');

    // 不良记录未审批 → 拒
    const def = await request(server)
      .post('/api/returns/defects')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-def-1')
      .send({ workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 10, reason: '外观不良' });
    expect(def.status).toBe(201);
    expect(def.body.status).toBe('PENDING_APPROVAL');
    const unapproved = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-def-1')
      .send({ type: 'DEFECT', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 5, defectDocNo: def.body.docNo });
    expect(unapproved.body.code).toBe('DEFECT_NOT_APPROVED');

    // QE 审批不良记录
    const ok = await request(server)
      .post(`/api/returns/defects/${def.body.id}/approve`)
      .set(auth(tokens.qe));
    expect(ok.status).toBe(201);

    // 登记数量(10) < 退料数(20) → 拒
    const tooMuch = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-def-2')
      .send({ type: 'DEFECT', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 20, defectDocNo: def.body.docNo });
    expect(tooMuch.body.code).toBe('DEFECT_QTY_EXCEED');

    // WO-B 无领用 → 可退上限 0，不良退 10 属超退：填原因 + 审批，单未过账（供 ⑥ 顺序控制）
    const ret = await request(server)
      .post('/api/returns')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-def-3')
      .send({ type: 'DEFECT', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 10, defectDocNo: def.body.docNo, reason: '不良品退回隔离' });
    expect(ret.status).toBe(201);
    expect(ret.body.toStatus).toBe('ISOLATED');
    expect(ret.body.status).toBe('PENDING_APPROVAL');
    defectReturnDocNo = ret.body.docNo;
    (globalThis as any).__defectReturnId = ret.body.id;
  });

  // ⑥ 一退一补顺序控制：未退先补被拒
  it('⑥ 一退一补：退料交接未完成时补料被拒，交接完成后可补', async () => {
    // ⑤ 的不良退料单仍在 PENDING_APPROVAL（未交接）→ 补料被拒
    const early = await request(server)
      .post('/api/returns/replenish')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-rar-0')
      .send({ type: 'RETURN_AND_REPLENISH', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 10, relatedReturnDocNo: defectReturnDocNo });
    expect(early.body.code).toBe('RETURN_NOT_COMPLETED');

    // 完成退料交接（仓库主管审批 + 过账）
    const retId = (globalThis as any).__defectReturnId as number;
    await request(server).post(`/api/returns/${retId}/approve`).set(auth(tokens.whm));
    const posted = await request(server)
      .post(`/api/returns/${retId}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-ret-def-post-1');
    expect(posted.body.status).toBe('POSTED');
    // 不良退料入 ISOLATED
    const lots = await request(server)
      .get(`/api/inventory/lots?materialCode=M-GEN&status=ISOLATED`)
      .set(auth(tokens.admin));
    expect(lots.body.some((l: any) => l.packageNo === posted.body.returnPackageNo)).toBe(true);

    // 交接完成 → 一退一补通过（WO-B 计划 100，10 未超限）
    const rep = await request(server)
      .post('/api/returns/replenish')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rep-rar-1')
      .send({ type: 'RETURN_AND_REPLENISH', workOrderId: 'WO-B', materialCode: 'M-GEN', qty: 10, relatedReturnDocNo: defectReturnDocNo });
    expect(rep.status).toBe(201);
    expect(rep.body.status).toBe('POSTED');
    expect(rep.body.isOver).toBe(false);
  });

  // ⑦ 损耗核销双审批，财务拒绝即作废
  it('⑦ 损耗核销：QE+财务双审批过账扣减并同步 U8；财务拒绝即作废', async () => {
    // 客检必填客户订单号
    const noCus = await request(server)
      .post('/api/returns/writeoffs')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-0')
      .send({ materialCode: 'M-GEN', batchNo: 'B-PKG-W1', packageNo: 'PKG-W1', qty: 30, reason: 'CUSTOMER_INSPECT' });
    expect(noCus.body.code).toBe('CUSTOMER_ORDER_REQUIRED');

    const wo = await request(server)
      .post('/api/returns/writeoffs')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-1')
      .send({ workOrderId: 'WO-A', materialCode: 'M-GEN', batchNo: 'B-PKG-W1', packageNo: 'PKG-W1', qty: 30, reason: 'CUSTOMER_INSPECT', customerOrderNo: 'CO-2026-001' });
    expect(wo.status).toBe(201);

    // 双审批未完成不得过账
    const postEarly = await request(server)
      .post(`/api/returns/writeoffs/${wo.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-post-0');
    expect(postEarly.body.code).toBe('NOT_APPROVED');

    // QE 一步审批后仍不得过账（两步都过才 APPROVED）
    await request(server).post(`/api/returns/writeoffs/${wo.body.id}/approve`).set(auth(tokens.qe));
    const postMid = await request(server)
      .post(`/api/returns/writeoffs/${wo.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-post-mid');
    expect(postMid.body.code).toBe('NOT_APPROVED');

    // 财务二审 → 过账：adjust 扣减 + U8 同步（一一对应）
    await request(server).post(`/api/returns/writeoffs/${wo.body.id}/approve`).set(auth(tokens.fin));
    const posted = await request(server)
      .post(`/api/returns/writeoffs/${wo.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-post-1');
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.u8Synced).toBe(true);
    const lots = await request(server).get('/api/inventory/lots?materialCode=M-GEN').set(auth(tokens.admin));
    expect(lots.body.find((l: any) => l.packageNo === 'PKG-W1').qty).toBe(170);
    const syncLogs = await request(server).get('/api/integration/logs').set(auth(tokens.admin));
    expect(syncLogs.body.some((t: any) => t.bizKey === wo.body.docNo && t.voucherType === 'WRITE_OFF' && t.status === 'SYNCED')).toBe(true);

    // CSV 导出
    const csv = await request(server).get('/api/returns/writeoffs/export').set(auth(tokens.admin));
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('docNo,workOrderId,materialCode');
    expect(csv.text).toContain(wo.body.docNo);

    // 财务拒绝 → 作废不得过账
    const wo2 = await request(server)
      .post('/api/returns/writeoffs')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-2')
      .send({ materialCode: 'M-GEN', batchNo: 'B-PKG-W1', packageNo: 'PKG-W1', qty: 10, reason: 'DESTRUCTIVE_TEST' });
    await request(server).post(`/api/returns/writeoffs/${wo2.body.id}/approve`).set(auth(tokens.qe));
    const rej = await request(server)
      .post(`/api/returns/writeoffs/${wo2.body.id}/reject`)
      .set(auth(tokens.fin))
      .send({ reason: '费用归属存疑' });
    expect(rej.body.status).toBe('VOID');
    const postVoid = await request(server)
      .post(`/api/returns/writeoffs/${wo2.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-wo-post-2');
    expect(postVoid.body.code).toBe('WRITEOFF_VOID');
    // 库存未被扣减
    const lots2 = await request(server).get('/api/inventory/lots?materialCode=M-GEN').set(auth(tokens.admin));
    expect(lots2.body.find((l: any) => l.packageNo === 'PKG-W1').qty).toBe(170);
  });

  // ⑧ 良→不良调拨无质检签确认不过账；反向调拨新建单关联原单
  it('⑧ 良/不良调拨：电子签前置、反向调拨关联原单、不良调回良品须审批', async () => {
    const qt = await request(server)
      .post('/api/returns/qtransfers')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-qt-1')
      .send({ packageNo: 'PKG-Q1', toStatus: 'ISOLATED', reason: '抽检不合格' });
    expect(qt.status).toBe(201);
    expect(qt.body.fromStatus).toBe('QUALIFIED');
    expect(qt.body.status).toBe('DRAFT'); // 良→不良无需审批，但须电子签

    // 未电子签 → 不过账
    const postEarly = await request(server)
      .post(`/api/returns/qtransfers/${qt.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-qt-post-0');
    expect(postEarly.body.code).toBe('QUALITY_CONFIRM_REQUIRED');

    // 非质检角色签署被拒
    const wrongSign = await request(server)
      .post(`/api/returns/qtransfers/${qt.body.id}/confirm`)
      .set(auth(tokens.pmc));
    expect(wrongSign.body.code).toBe('QUALITY_ROLE_REQUIRED');

    // 质检员电子签 → 过账
    const sign = await request(server)
      .post(`/api/returns/qtransfers/${qt.body.id}/confirm`)
      .set(auth(tokens.insp));
    expect(sign.body.confirmBy).toBe('insp01');
    expect(sign.body.confirmRole).toBe('INSPECTOR');
    const posted = await request(server)
      .post(`/api/returns/qtransfers/${qt.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-qt-post-1');
    expect(posted.body.status).toBe('POSTED');
    // 两边库存平衡：总量不变，状态翻转
    const lots = await request(server).get('/api/inventory/lots?materialCode=M-GEN').set(auth(tokens.admin));
    const q1 = lots.body.find((l: any) => l.packageNo === 'PKG-Q1');
    expect(q1.qty).toBe(80);
    expect(q1.status).toBe('ISOLATED');

    // 反向调拨：新建反向单关联原单（ISOLATED→QUALIFIED 须重新审批 + 电子签）
    const rev = await request(server)
      .post(`/api/returns/qtransfers/${qt.body.id}/reverse`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-qt-rev-1')
      .send({ reason: '复检合格调回' });
    expect(rev.status).toBe(201);
    expect(rev.body.reverseOfDocNo).toBe(qt.body.docNo);
    expect(rev.body.status).toBe('PENDING_APPROVAL'); // 不良调回良品须审批
    await request(server).post(`/api/returns/qtransfers/${rev.body.id}/confirm`).set(auth(tokens.insp));
    await request(server).post(`/api/returns/qtransfers/${rev.body.id}/approve`).set(auth(tokens.qe));
    const revPosted = await request(server)
      .post(`/api/returns/qtransfers/${rev.body.id}/post`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-qt-rev-post-1');
    expect(revPosted.body.status).toBe('POSTED');
    const lots2 = await request(server).get('/api/inventory/lots?materialCode=M-GEN').set(auth(tokens.admin));
    expect(lots2.body.find((l: any) => l.packageNo === 'PKG-Q1').status).toBe('QUALIFIED');

    // 原单不改写：仍为 POSTED 且方向不变
    const origin = await request(server).get(`/api/returns/qtransfers/${qt.body.id}`).set(auth(tokens.admin));
    expect(origin.body.status).toBe('POSTED');
    expect(origin.body.toStatus).toBe('ISOLATED');
  });

  // ⑨ 补料待办生成与反向挪料关闭
  it('⑨ 到货补回：生成补料待办，PMC 确认创建反向挪料并关闭', async () => {
    const check = await request(server)
      .post('/api/transfer/replenish-check')
      .set(auth(tokens.pmc))
      .send({ materialCode: 'M-SPC' });
    expect(check.status).toBe(201);
    const todo = check.body.find((t: any) => t.workOrderId === 'WO-A');
    expect(todo).toBeTruthy();
    expect(todo.movedQty).toBe(30);
    expect(todo.status).toBe('OPEN');

    // 重复扫描不重复生成
    const check2 = await request(server)
      .post('/api/transfer/replenish-check')
      .set(auth(tokens.pmc))
      .send({ materialCode: 'M-SPC' });
    expect(check2.body).toHaveLength(0);

    // PMC 确认 → 反向挪料单（WO-B→WO-A 30）+ 关闭待办
    const confirm = await request(server)
      .post(`/api/transfer/replenish/${todo.id}/confirm`)
      .set(auth(tokens.pmc))
      .set('X-Request-Id', 'exc-replenish-confirm-1');
    expect(confirm.status).toBe(201);
    expect(confirm.body.todo.status).toBe('CLOSED');
    expect(confirm.body.reverse.kind).toBe('REPLENISH');
    expect(confirm.body.reverse.sourceWorkOrderId).toBe('WO-B');
    expect(confirm.body.reverse.targetWorkOrderId).toBe('WO-A');
    expect(confirm.body.reverse.status).toBe('POSTED');

    // 占用回补：WO-A 30 / WO-B 0
    const batches = await request(server)
      .get('/api/transfer/batches?materialCode=M-SPC')
      .set(auth(tokens.admin));
    expect(batches.body.occupations.find((o: any) => o.workOrderId === 'WO-A')?.qty).toBe(30);
    expect(batches.body.occupations.find((o: any) => o.workOrderId === 'WO-B')).toBeUndefined();

    // 挪料路径追溯：原单 + 反向单链路；原挪料记录保留
    const trace = await request(server).get('/api/transfer/trace/B-PKG-T1').set(auth(tokens.admin));
    expect(trace.body.chain).toHaveLength(2);
    expect(trace.body.chain[0].kind).toBe('NORMAL');
    expect(trace.body.chain[1].kind).toBe('REPLENISH');
    expect(trace.body.chain[1].relatedDocNo).toBe(trace.body.chain[0].docNo);
    const origin = await request(server).get(`/api/transfer/${spcTransferId}`).set(auth(tokens.admin));
    expect(origin.body.status).toBe('POSTED');
    expect(origin.body.sourceWorkOrderId).toBe('WO-A');
  });

  // ⑩ 返工未批准领料被拒
  it('⑩ 返工：未批准领料被拒，批准后可发料', async () => {
    // WO-C 占用 M-GEN 20（备料 PREP-RW1）
    const occ = await request(server)
      .post('/api/inventory/occupy')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-occ-rw-1')
      .send({ workOrderId: 'WO-C', items: [{ materialCode: 'M-GEN', qty: 20 }], prepDocNo: 'PREP-RW1' });
    expect(occ.status).toBe(201);

    const rw = await request(server)
      .post('/api/transfer/rework')
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rw-1')
      .send({ workOrderId: 'WO-C', materialCode: 'M-GEN', qty: 10, reason: '装配不良返工' });
    expect(rw.status).toBe(201);
    expect(rw.body.status).toBe('PENDING_APPROVAL');

    // 无已批准返工单 → 返工领料被拒
    const early = await request(server)
      .post(`/api/transfer/rework/${rw.body.id}/issue`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rw-issue-0')
      .send({ prepDocNo: 'PREP-RW1' });
    expect(early.body.code).toBe('REWORK_NOT_APPROVED');

    // 班组长批准 → 发料成功
    const ok = await request(server)
      .post(`/api/transfer/rework/${rw.body.id}/approve`)
      .set(auth(tokens.leader));
    expect(ok.body.status).toBe('APPROVED');
    const issued = await request(server)
      .post(`/api/transfer/rework/${rw.body.id}/issue`)
      .set(auth(tokens.admin))
      .set('X-Request-Id', 'exc-rw-issue-1')
      .send({ prepDocNo: 'PREP-RW1' });
    expect(issued.status).toBe(201);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.issuedAt).toBeTruthy();
  });
});
