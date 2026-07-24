import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, Module, ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
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
import { ShippingModule, SHIPPING_ENTITIES } from '../../src/modules/shipping/shipping.module';
import { DocStatus } from '../../src/common/enums';

/**
 * shipping 模块 e2e 专用装配（不动 test/helpers.ts 与 app.spec.ts）：
 * 与 src/app.module.ts 自动发现结果等价 + ShippingModule 静态注册。
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: [...TEST_ENTITIES, ...SHIPPING_ENTITIES],
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
    ShippingModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class ShippingTestAppModule {}

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('shipping 发运追溯链 e2e', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;
  let keeperToken: string;
  /** U8 拉取的发货单（DN20260723-001, CUS001, P-9001×50） */
  let u8NoteId: number;
  let u8DnNo: string;
  /** 销售创建的多订单发货单（装柜顺序测试用） */
  let salesNoteId: number;
  let salesDnNo: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const rid = (n: string) => ({ 'X-Request-Id': `shp-e2e-${n}` });

  beforeAll(async () => {
    app = await NestFactory.create(ShippingTestAppModule, { logger: false });
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

    await seedData(app.get(DataSource));
    app.get(SyncService).retryDelaysMs = [5, 10, 15];

    const login = async (username: string, password: string) => {
      const res = await request(server).post('/api/auth/login').send({ username, password });
      expect(res.status).toBe(201);
      return res.body.token as string;
    };
    adminToken = await login('admin', 'Admin@123');
    keeperToken = await login('keeper01', 'Keep@123');

    // 基础序列号（P-9001 成品，工单 WO20260724-001 由种子提供）
    const reg = await request(server)
      .post('/api/shipping/serials')
      .set(auth(adminToken))
      .set(rid('reg-base'))
      .send({
        serials: [
          { serialNo: 'SN-A1', productCode: 'P-9001', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' },
          { serialNo: 'SN-A2', productCode: 'P-9001', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' },
          { serialNo: 'SN-A3', productCode: 'P-9001', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' },
          { serialNo: 'SN-X1', productCode: 'P-OTHER', batchNo: 'BX', workOrderId: 'WO20260724-001' },
          { serialNo: 'SN-S1', productCode: 'P-9001', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' },
          { serialNo: 'SN-S2', productCode: 'P-9002', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' },
        ],
      });
    expect(reg.status).toBe(201);
    expect(reg.body.created).toHaveLength(6);
  });

  afterAll(async () => {
    await app.close();
  });

  it('① 发货通知重复拉取不重复任务（dnNo 幂等）', async () => {
    const first = await request(server)
      .post('/api/shipping/pull-notes')
      .set(auth(adminToken))
      .set(rid('pull-1'))
      .send({});
    expect(first.status).toBe(201);
    expect(first.body.created).toEqual(['DN20260723-001']);

    const second = await request(server)
      .post('/api/shipping/pull-notes')
      .set(auth(adminToken))
      .set(rid('pull-2'))
      .send({});
    expect(second.status).toBe(201);
    expect(second.body.created).toEqual([]);
    expect(second.body.skipped).toEqual(['DN20260723-001']);

    const notes = await request(server)
      .get('/api/shipping/notes?status=DRAFT')
      .set(auth(adminToken));
    const dn = notes.body.find((n: any) => n.dnNo === 'DN20260723-001');
    expect(dn).toBeTruthy();
    expect(dn.customerName).toBe('苏泊尔');
    expect(dn.expectedQty).toBe(50);
    u8NoteId = dn.id;
    u8DnNo = dn.dnNo;

    const detail = await request(server)
      .get(`/api/shipping/notes/${u8NoteId}`)
      .set(auth(adminToken));
    expect(detail.body.lines).toHaveLength(1);
    expect(detail.body.lines[0].productCode).toBe('P-9001');
  });

  it('② 出库扫码三重校验：不存在 / 重复扫 / 跨订单归属', async () => {
    // 序列号不存在
    const notFound = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-404'))
      .send({ serialNo: 'SN-NOPE' });
    expect(notFound.status).toBe(404);
    expect(notFound.body.code).toBe('SERIAL_NOT_FOUND');

    // 正常扫入
    const ok = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-a1'))
      .send({ serialNo: 'SN-A1' });
    expect(ok.status).toBe(201);
    expect(ok.body.scannedQty).toBe(1);
    expect(ok.body.shortageQty).toBe(49);

    // 重复扫描：阻止并返回原扫码时间/人员
    const dup = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/scan`)
      .set(auth(adminToken))
      .set(rid('scan-a1-dup'))
      .send({ serialNo: 'SN-A1' });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('DUPLICATE_SCAN');
    expect(dup.body.message).toContain('keeper01'); // 原扫码人员

    const after = await request(server)
      .get(`/api/shipping/notes/${u8NoteId}`)
      .set(auth(adminToken));
    expect(after.body.duplicateScanCount).toBe(1);
    expect(after.body.scannedQty).toBe(1); // 未重复计数

    // 归属错误：序列号不属于本单客户订单
    const wrong = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-x1'))
      .send({ serialNo: 'SN-X1' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('WRONG_ORDER');
  });

  it('③ 装柜顺序：跳单/混扫被拒并提示应扫的下一件', async () => {
    const created = await request(server)
      .post('/api/shipping/notes')
      .set(auth(adminToken))
      .set(rid('create-sales'))
      .send({
        customerCode: 'CUS002',
        loadingSequence: ['SO-1', 'SO-2'],
        lines: [
          { orderNo: 'SO-1', productCode: 'P-9001', qty: 1 },
          { orderNo: 'SO-2', productCode: 'P-9002', qty: 1 },
        ],
      });
    expect(created.status).toBe(201);
    salesNoteId = created.body.id;
    salesDnNo = created.body.dnNo;
    expect(salesDnNo).toMatch(/^SHP\d{8}-\d{4}$/);

    // 跳扫 SO-2 的货 → 拒绝并提示应先扫 SO-1
    const skip = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-s2-first'))
      .send({ serialNo: 'SN-S2' });
    expect(skip.status).toBe(400);
    expect(skip.body.code).toBe('SEQUENCE_VIOLATION');
    expect(skip.body.message).toContain('SO-1');
    expect(skip.body.message).toContain('P-9001');

    // 按顺序先扫 SO-1 → 通过；nextExpected 指向 SO-2
    const s1 = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-s1'))
      .send({ serialNo: 'SN-S1' });
    expect(s1.status).toBe(201);
    expect(s1.body.nextExpected).toMatchObject({ orderNo: 'SO-2', productCode: 'P-9002' });

    // SO-1 完成后才允许 SO-2
    const s2 = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-s2'))
      .send({ serialNo: 'SN-S2' });
    expect(s2.status).toBe(201);
    expect(s2.body.nextExpected).toBeNull();
  });

  it('④⑤ 少发审批 → 双确认放行 → U8 SYNCED → 序列号已出库', async () => {
    // 再扫 2 件（累计 3/50）
    for (const sn of ['SN-A2', 'SN-A3']) {
      const r = await request(server)
        .post(`/api/shipping/notes/${u8NoteId}/scan`)
        .set(auth(keeperToken))
        .set(rid(`scan-${sn}`))
        .send({ serialNo: sn });
      expect(r.status).toBe(201);
    }

    // 欠发 47 件，未走少发审批直接放行 → 拒
    const relBlocked = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-blocked'))
      .send({ keeperConfirm: true, driverName: '张师傅', driverConfirm: true });
    expect(relBlocked.status).toBe(400);
    expect(relBlocked.body.code).toBe('SHORT_SHIP_NOT_APPROVED');

    // 少发原因必填
    const noReason = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/short-ship`)
      .set(auth(keeperToken))
      .set(rid('ss-noreason'))
      .send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('SHORT_SHIP_REASON_REQUIRED');

    // 发起少发申请（仓管员申请，admin 审批 → 禁止自审规则满足）
    const ss = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/short-ship`)
      .set(auth(keeperToken))
      .set(rid('ss-1'))
      .send({ reason: '产线缺料，余量次月补发' });
    expect(ss.status).toBe(201);
    expect(ss.body.shortages).toHaveLength(1);
    expect(ss.body.shortages[0].qty).toBe(47);
    expect(ss.body.shortages[0].status).toBe('PENDING_APPROVAL');
    expect(ss.body.shortages[0].reshipStatus).toBe('OPEN');
    const approvalId = ss.body.approvalId;

    // 审批未通过前放行 → 拒
    const relPending = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-pending'))
      .send({ keeperConfirm: true, driverName: '张师傅', driverConfirm: true });
    expect(relPending.status).toBe(400);
    expect(relPending.body.code).toBe('SHORT_SHIP_NOT_APPROVED');

    // 审批通过 → 单据 APPROVED，欠发记录 APPROVED 且持续留存
    const ap = await request(server)
      .post(`/api/shipping/approvals/${approvalId}/approve`)
      .set(auth(adminToken))
      .set(rid('ss-ap'))
      .send({ approve: true, comment: '同意部分放行' });
    expect(ap.status).toBe(201);
    expect(ap.body.status).toBe('APPROVED');

    const afterAp = await request(server)
      .get(`/api/shipping/notes/${u8NoteId}`)
      .set(auth(adminToken));
    expect(afterAp.body.status).toBe(DocStatus.APPROVED);
    expect(afterAp.body.shortages[0].status).toBe('APPROVED');
    expect(afterAp.body.shortages[0].reshipStatus).toBe('OPEN');

    // 无双确认（缺司机确认）→ 拒
    const noDual = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-nodual'))
      .send({ keeperConfirm: true });
    expect(noDual.status).toBe(400);
    expect(noDual.body.code).toBe('DUAL_CONFIRM_REQUIRED');

    // 仓管员+司机双确认 → 放行 → U8 销售出库 SYNCED
    const rel = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-ok'))
      .send({ keeperConfirm: true, driverName: '张师傅', driverConfirm: true });
    expect(rel.status).toBe(201);
    expect(rel.body.status).toBe(DocStatus.SYNCED);
    expect(rel.body.syncStatus).toBe(DocStatus.SYNCED);
    expect(rel.body.keeperConfirmBy).toBe('keeper01');
    expect(rel.body.driverName).toBe('张师傅');
    expect(rel.body.scannedQty).toBe(3);
    expect(rel.body.shortageQty).toBe(47);

    // U8 同步日志含 SALE_OUT
    const logs = await request(server).get('/api/integration/logs').set(auth(adminToken));
    const saleOut = logs.body.find((t: any) => t.bizKey === u8DnNo);
    expect(saleOut).toBeTruthy();
    expect(saleOut.voucherType).toBe('SALE_OUT');
    expect(saleOut.status).toBe(DocStatus.SYNCED);

    // 序列号状态已出库
    const shipped = await request(server)
      .get('/api/shipping/serials?status=SHIPPED')
      .set(auth(adminToken));
    const shippedNos = shipped.body.map((s: any) => s.serialNo);
    expect(shippedNos).toEqual(expect.arrayContaining(['SN-A1', 'SN-A2', 'SN-A3']));
    expect(shipped.body.find((s: any) => s.serialNo === 'SN-A1').shippedDnNo).toBe(u8DnNo);
  });

  it('⑥ 放行后原单锁定：再扫码被拒 → 红字冲销单创建', async () => {
    const scanLocked = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/scan`)
      .set(auth(keeperToken))
      .set(rid('scan-locked'))
      .send({ serialNo: 'SN-S1' });
    expect(scanLocked.status).toBe(400);
    expect(scanLocked.body.code).toBe('SHIP_NOTE_LOCKED');

    const relLocked = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-locked'))
      .send({ keeperConfirm: true, driverName: '张师傅', driverConfirm: true });
    expect(relLocked.status).toBe(400);
    expect(relLocked.body.code).toBe('SHIP_NOTE_LOCKED');

    const rev = await request(server)
      .post(`/api/shipping/notes/${u8NoteId}/reversal`)
      .set(auth(adminToken))
      .set(rid('rev-1'))
      .send({ reason: '客户取消订单，红字冲销' });
    expect(rev.status).toBe(201);
    expect(rev.body.reversalNo).toMatch(/^SHP\d{8}-\d{4}$/);
    expect(rev.body.dnNo).toBe(u8DnNo);
    expect(rev.body.status).toBe(DocStatus.SYNCED);

    // 原单保留并置 REVERSED；序列号回库
    const after = await request(server)
      .get(`/api/shipping/notes/${u8NoteId}`)
      .set(auth(adminToken));
    expect(after.body.status).toBe(DocStatus.REVERSED);
    const back = await request(server)
      .get('/api/shipping/serials?status=IN_STOCK')
      .set(auth(adminToken));
    expect(back.body.map((s: any) => s.serialNo)).toEqual(
      expect.arrayContaining(['SN-A1', 'SN-A2', 'SN-A3']),
    );
  });

  it('⑦⑨ 通用上传：命名规则 + 落盘 + url + 非法格式拒绝 + 照片确认重传不重复', async () => {
    const upload = async (photoType: string) =>
      request(server)
        .post('/api/common/upload')
        .set(auth(keeperToken))
        .field('docNo', salesDnNo)
        .field('photoType', photoType)
        .attach('file', JPG, 'shot.jpg');

    // 非法格式拒绝
    const bad = await request(server)
      .post('/api/common/upload')
      .set(auth(keeperToken))
      .attach('file', Buffer.from('hello'), 'a.txt');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_FILE_TYPE');

    // 六类照片上传：命名 = 发货单号_类型_毫秒时间戳.jpg，按年月归档
    const urls: { photoType: string; url: string }[] = [];
    for (const t of ['CAR', 'SEAL', 'EMPTY', 'SIDE1', 'SIDE2', 'MARK']) {
      const res = await upload(t);
      expect(res.status).toBe(201);
      expect(res.body.fileName).toMatch(new RegExp(`^${salesDnNo}_${t}_\\d+\\.jpg$`));
      expect(res.body.url).toMatch(new RegExp(`^/api/common/files/\\d{6}/${salesDnNo}_${t}_\\d+\\.jpg$`));
      // 落盘校验
      const disk = path.join(process.cwd(), 'data', 'uploads', res.body.url.split('/').slice(-2).join('/'));
      expect(fs.existsSync(disk)).toBe(true);
      urls.push({ photoType: t, url: res.body.url });
    }

    // 文件访问（登录即可）
    const dl = await request(server).get(urls[0].url).set(auth(adminToken));
    expect(dl.status).toBe(200);

    // 照片确认：全部 CONFIRMED 且清单完整
    const confirm = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/photos/confirm`)
      .set(auth(keeperToken))
      .set(rid('photo-1'))
      .send({ photos: urls });
    expect(confirm.status).toBe(201);
    expect(confirm.body.complete).toBe(true);
    expect(confirm.body.confirmed).toHaveLength(6);
    expect(confirm.body.pending).toHaveLength(0);

    // 重传同文件名清单 → 不重复
    const again = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/photos/confirm`)
      .set(auth(keeperToken))
      .set(rid('photo-2'))
      .send({ photos: urls });
    expect(again.status).toBe(201);
    expect(again.body.confirmed).toHaveLength(6);

    // 服务器端完整性校验失败（文件不存在）→ 保留待传
    const miss = await request(server)
      .post(`/api/shipping/notes/${salesNoteId}/photos/confirm`)
      .set(auth(keeperToken))
      .set(rid('photo-3'))
      .send({ photos: [{ photoType: 'CAR', url: '/api/common/files/202607/NOPE_1.jpg' }] });
    expect(miss.status).toBe(201);
    expect(miss.body.pending).toHaveLength(1);
    expect(miss.body.pending[0].reason).toContain('不存在');
  });

  it('⑧ 双向追溯：backward 返回批次/供应商，forward 返回客户，export CSV', async () => {
    // 原料批次（工单关联，供反向追溯）
    const inb = await request(server)
      .post('/api/inventory/inbound')
      .set(auth(adminToken))
      .set(rid('inb-tr'))
      .send({
        packageNo: 'PKG-TR-1',
        materialCode: 'M-1001',
        batchNo: 'BTR-1',
        qty: 10,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        workOrderId: 'WO20260724-001',
        sourceDocNo: 'RCV-TR-1',
      });
    expect(inb.status).toBe(201);

    // SN-TR-1 走完发货（客户 CUS002），让 forward 链到客户
    const reg = await request(server)
      .post('/api/shipping/serials')
      .set(auth(adminToken))
      .set(rid('reg-tr'))
      .send({ serials: [{ serialNo: 'SN-TR-1', productCode: 'P-9001', batchNo: 'BTR-1', workOrderId: 'WO20260724-001' }] });
    expect(reg.status).toBe(201);

    const note = await request(server)
      .post('/api/shipping/notes')
      .set(auth(adminToken))
      .set(rid('create-tr'))
      .send({ customerCode: 'CUS002', lines: [{ orderNo: 'SO-TR', productCode: 'P-9001', qty: 1 }] });
    expect(note.status).toBe(201);
    const trNoteId = note.body.id;

    expect(
      (
        await request(server)
          .post(`/api/shipping/notes/${trNoteId}/scan`)
          .set(auth(keeperToken))
          .set(rid('scan-tr'))
          .send({ serialNo: 'SN-TR-1' })
      ).status,
    ).toBe(201);
    const rel = await request(server)
      .post(`/api/shipping/notes/${trNoteId}/release`)
      .set(auth(keeperToken))
      .set(rid('rel-tr'))
      .send({ keeperConfirm: true, driverName: '李师傅', driverConfirm: true });
    expect(rel.status).toBe(201);
    expect(rel.body.status).toBe(DocStatus.SYNCED);

    // backward：序列号 → 工单 → 原料批次 → 供应商 → 来料日期
    const back = await request(server)
      .get('/api/shipping/trace/backward?serialNo=SN-TR-1')
      .set(auth(adminToken));
    expect(back.status).toBe(200);
    expect(back.body.workOrder.workOrderId).toBe('WO20260724-001');
    expect(back.body.batches[0].batchNo).toBe('BTR-1');
    expect(back.body.batches[0].materialCode).toBe('M-1001');
    expect(back.body.batches[0].supplierCode).toBe('SUP001');
    expect(back.body.batches[0].supplierName).toBe('宁波线缆厂');
    expect(back.body.batches[0].receivedAt).toBeTruthy();
    expect(back.body.shipment.customerCode).toBe('CUS002');

    // forward：原料批次 → 工单 → 序列号 → 发货单 → 客户
    const fwd = await request(server)
      .get('/api/shipping/trace/forward?batchNo=BTR-1')
      .set(auth(adminToken));
    expect(fwd.status).toBe(200);
    expect(fwd.body.workOrders[0].workOrderId).toBe('WO20260724-001');
    expect(fwd.body.serials.map((s: any) => s.serialNo)).toContain('SN-TR-1');
    expect(fwd.body.shipments.map((s: any) => s.dnNo)).toContain(note.body.dnNo);
    // 同工单 SN-A1..A3 曾入 CUS001 单（已冲销），故按发货单逐单断言客户
    const trShip = fwd.body.shipments.find((s: any) => s.dnNo === note.body.dnNo);
    expect(trShip.customerCode).toBe('CUS002');
    expect(trShip.customerName).toBe('九阳');
    expect(fwd.body.customer).toBeTruthy();

    // 缺链路段：序列号无工单批次关联 → 理论 BOM 追溯
    await request(server)
      .post('/api/shipping/serials')
      .set(auth(adminToken))
      .set(rid('reg-orphan'))
      .send({ serials: [{ serialNo: 'SN-ORPHAN', productCode: 'P-9001' }] });
    const orphan = await request(server)
      .get('/api/shipping/trace/backward?serialNo=SN-ORPHAN')
      .set(auth(adminToken));
    expect(orphan.status).toBe(200);
    expect(orphan.body.workOrder).toBeNull();
    expect(orphan.body.batches).toEqual([]);

    // export CSV
    const csv = await request(server)
      .get('/api/shipping/trace/export?serialNo=SN-TR-1')
      .set(auth(adminToken));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('SN-TR-1');
    expect(csv.text).toContain('SUP001');
    expect(csv.text).toContain('BTR-1');
  });
});
