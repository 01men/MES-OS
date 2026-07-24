import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, Module, ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { DocStatus } from '../../src/common/enums';
import { AuditLog } from '../../src/common/audit/audit.entity';
import { DingTalkService } from '../../src/modules/auth/dingtalk.service';

/**
 * e2e 根模块：静态装配（Vitest 环境下不用运行时自动发现）。
 * 与 src/app.module.ts 的自动发现结果等价。
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: TEST_ENTITIES,
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
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class TestAppModule {}

describe('MES WMS e2e（supertest + 内存 sqljs 完整 App）', () => {
  let app: INestApplication;
  let server: any;
  let adminToken: string;
  let receiverToken: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestAppModule, { logger: false });
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

    // 种子数据 + 测试化配置
    await seedData(app.get(DataSource));
    const sync = app.get(SyncService);
    sync.retryDelaysMs = [5, 10, 15];

    const adminLogin = await request(server)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@123' });
    expect(adminLogin.status).toBe(201);
    adminToken = adminLogin.body.token;

    const recvLogin = await request(server)
      .post('/api/auth/login')
      .send({ username: 'receiver01', password: 'Recv@123' });
    expect(recvLogin.status).toBe(201);
    receiverToken = recvLogin.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('无 token 访问受保护接口 → 401', async () => {
    const res = await request(server).get('/api/masterdata/materials');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('越权访问（收料员无 masterdata.material.create）→ 403', async () => {
    const res = await request(server)
      .post('/api/masterdata/materials')
      .set(auth(receiverToken))
      .send({ materialCode: 'M-T1', name: '越权物料' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('masterdata 建物料 → inventory inbound → available 正确', async () => {
    const create = await request(server)
      .post('/api/masterdata/materials')
      .set(auth(adminToken))
      .send({ materialCode: 'M-T1', name: '测试物料', safetyStock: 10, unit: 'PCS' });
    expect(create.status).toBe(201);
    expect(create.body.materialCode).toBe('M-T1');

    const in1 = await request(server)
      .post('/api/inventory/inbound')
      .set(auth(adminToken))
      .set('X-Request-Id', 'e2e-rid-in-1')
      .send({
        packageNo: 'PKG-E2E-1',
        materialCode: 'M-T1',
        batchNo: 'B1',
        qty: 100,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        sourceDocNo: 'RCV-E2E-1',
      });
    expect(in1.status).toBe(201);
    expect(in1.body.status).toBe('QUALIFIED');

    // 同 X-Request-Id 重放 → 不重复入库
    const replay = await request(server)
      .post('/api/inventory/inbound')
      .set(auth(adminToken))
      .set('X-Request-Id', 'e2e-rid-in-1')
      .send({
        packageNo: 'PKG-E2E-1',
        materialCode: 'M-T1',
        batchNo: 'B1',
        qty: 100,
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        sourceDocNo: 'RCV-E2E-1',
      });
    expect(replay.status).toBe(201);

    const lots = await request(server)
      .get('/api/inventory/lots?materialCode=M-T1')
      .set(auth(adminToken));
    expect(lots.body).toHaveLength(1);

    const avail = await request(server)
      .get('/api/inventory/available/M-T1')
      .set(auth(adminToken));
    expect(avail.status).toBe(200);
    expect(avail.body.qualifiedQty).toBe(100);
    expect(avail.body.safetyStock).toBe(10);
    expect(avail.body.available).toBe(90);
  });

  it('integration：mock 故障 → 重试 → SYNC_ERROR → 人工重放 → SYNCED（幂等）', async () => {
    // 打开 U8 故障开关
    const failOn = await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'u8.mockFailure', value: 'true' });
    expect(failOn.status).toBe(201);

    // 入队同步：3 次重试后 SYNC_ERROR
    const enq = await request(server)
      .post('/api/integration/sync')
      .set(auth(adminToken))
      .send({
        bizType: 'receiving',
        bizKey: 'RCV-E2E-1',
        voucherType: 'RECEIVE',
        payload: { packageNo: 'PKG-E2E-1', qty: 100 },
      });
    expect(enq.status).toBe(201);
    expect(enq.body.status).toBe(DocStatus.SYNC_ERROR);
    expect(enq.body.attempts).toBe(3);
    expect(enq.body.alarm).toContain('failed');
    const taskId = enq.body.id;

    const logs = await request(server)
      .get('/api/integration/logs')
      .set(auth(adminToken));
    expect(logs.body.some((t: any) => t.id === taskId && t.status === DocStatus.SYNC_ERROR)).toBe(true);

    // 故障未恢复时重放仍失败
    const replayFail = await request(server)
      .post(`/api/integration/replay/${taskId}`)
      .set(auth(adminToken));
    expect(replayFail.body.task.status).toBe(DocStatus.SYNC_ERROR);

    // 关闭故障开关 → 人工重放 → SYNCED
    await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'u8.mockFailure', value: 'false' });
    const replayOk = await request(server)
      .post(`/api/integration/replay/${taskId}`)
      .set(auth(adminToken));
    expect(replayOk.status).toBe(201);
    expect(replayOk.body.task.status).toBe(DocStatus.SYNCED);
    expect(replayOk.body.replayed).toBe(true);

    // 再次重放：幂等，不产生重复 U8 单据
    const replayAgain = await request(server)
      .post(`/api/integration/replay/${taskId}`)
      .set(auth(adminToken));
    expect(replayAgain.body.task.status).toBe(DocStatus.SYNCED);
    expect(replayAgain.body.replayed).toBe(false);

    // 日终对账无差异
    const rec = await request(server)
      .post('/api/integration/reconcile')
      .set(auth(adminToken));
    expect(rec.body.inMesNotU8).toEqual([]);
    expect(rec.body.inU8NotMes).toEqual([]);
  });

  it('mock-u8 供给侧接口无需 token 且不走 /api 前缀', async () => {
    const res = await request(server).get('/mock-u8/purchase-orders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const incremental = await request(server).get(
      '/mock-u8/purchase-orders?since=2026-07-21T00:00:00.000Z',
    );
    expect(incremental.body.data).toHaveLength(1);
  });

  it('offline sync 幂等入口：同 X-Request-Id 重放返回首个响应', async () => {
    const body = {
      deviceId: 'PDA-01',
      operatorId: 'receiver01',
      tasks: [{ taskNo: 'OT-1', bizTime: '2026-07-24T01:00:00Z', payload: { a: 1 } }],
    };
    const first = await request(server)
      .post('/api/offline/sync')
      .set(auth(receiverToken))
      .set('X-Request-Id', 'e2e-rid-off-1')
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.accepted).toEqual(['OT-1']);

    const second = await request(server)
      .post('/api/offline/sync')
      .set(auth(receiverToken))
      .set('X-Request-Id', 'e2e-rid-off-1')
      .send(body);
    expect(second.body).toEqual(first.body);
  });

  it('RBAC REST：登录下发权限，管理员可查询/分配，普通用户被拒绝', async () => {
    const login = await request(server)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@123' });
    expect(login.body.user.roles).toContain('ADMIN');
    expect(login.body.user.perms).toContain('*');

    const forbidden = await request(server)
      .get('/api/rbac/users')
      .set(auth(receiverToken));
    expect(forbidden.status).toBe(403);

    const users = await request(server)
      .get('/api/rbac/users')
      .set(auth(adminToken));
    expect(users.status).toBe(200);
    expect(users.body[0].passwordHash).toBeUndefined();
    const receiver = users.body.find((u: any) => u.username === 'receiver01');

    const roles = await request(server)
      .get('/api/rbac/roles')
      .set(auth(adminToken));
    const receiverRole = roles.body.find((r: any) => r.code === 'RECEIVER');

    const assigned = await request(server)
      .post(`/api/rbac/users/${receiver.id}/roles`)
      .set(auth(adminToken))
      .send({ roles: [receiverRole.id] });
    expect(assigned.status).toBe(201);
    expect(assigned.body.roles.map((r: any) => r.code)).toEqual(['RECEIVER']);

    const audit = await app
      .get(DataSource)
      .getRepository(AuditLog)
      .findOne({ where: { action: 'rbac.user.roles.assign' } });
    expect(audit?.operator).toBe('admin');
    expect(audit?.docNo).toBe('receiver01');
  });

  it('离线重放只传稳定 X-Task-No 也能命中幂等记录', async () => {
    const body = {
      deviceId: 'PDA-01',
      operatorId: 'receiver01',
      tasks: [
        {
          taskNo: 'OT-XTASK-1',
          bizTime: '2026-07-24T01:00:00Z',
          payload: { a: 2 },
        },
      ],
    };
    const first = await request(server)
      .post('/api/offline/sync')
      .set(auth(receiverToken))
      .set('X-Task-No', 'OT-XTASK-REQUEST-1')
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.accepted).toEqual(['OT-XTASK-1']);

    const second = await request(server)
      .post('/api/offline/sync')
      .set(auth(receiverToken))
      .set('X-Task-No', 'OT-XTASK-REQUEST-1')
      .send(body);
    expect(second.body).toEqual(first.body);
  });

  it('临时授权：创建后立即生效，撤销后立即失效，全程写审计', async () => {
    const users = await request(server)
      .get('/api/rbac/users')
      .set(auth(adminToken));
    const receiver = users.body.find((user: any) => user.username === 'receiver01');

    await request(server)
      .get('/api/rbac/users')
      .set(auth(receiverToken))
      .expect(403);

    const created = await request(server)
      .post('/api/rbac/temp-grants')
      .set(auth(adminToken))
      .send({
        userId: receiver.id,
        permissionCode: 'rbac.read',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(created.status).toBe(201);
    expect(created.body.permissionCode).toBe('rbac.read');

    await request(server)
      .get('/api/rbac/users')
      .set(auth(receiverToken))
      .expect(200);

    await request(server)
      .delete(`/api/rbac/temp-grants/${created.body.id}`)
      .set(auth(adminToken))
      .expect(200);

    await request(server)
      .get('/api/rbac/users')
      .set(auth(receiverToken))
      .expect(403);

    const actions = (
      await app.get(DataSource).getRepository(AuditLog).find({
        where: { docNo: 'receiver01' },
      })
    ).map((row) => row.action);
    expect(actions).toContain('rbac.temp-grant.create');
    expect(actions).toContain('rbac.temp-grant.revoke');
  });

  it('钉钉 OAuth：绑定、一次性 state、登录签发 JWT、解绑', async () => {
    const oldId = process.env.MES_DINGTALK_CLIENT_ID;
    const oldSecret = process.env.MES_DINGTALK_CLIENT_SECRET;
    const oldOrigin = process.env.MES_PUBLIC_ORIGIN;
    process.env.MES_DINGTALK_CLIENT_ID = 'ding-e2e';
    process.env.MES_DINGTALK_CLIENT_SECRET = 'e2e-secret';
    process.env.MES_PUBLIC_ORIGIN = 'http://127.0.0.1:5173';
    const dingtalk = app.get(DingTalkService);
    const exchange = vi.spyOn(dingtalk, 'exchangeAuthCode').mockResolvedValue({
      unionId: 'union-receiver-01',
      openId: 'open-receiver-01',
      nick: '收料员一号',
    });

    try {
      const config = await request(server).get('/api/auth/config');
      expect(config.status).toBe(200);
      expect(config.body.dingtalkEnabled).toBe(true);

      const bindUrl = await request(server)
        .get('/api/auth/dingtalk/bind-url')
        .set(auth(receiverToken));
      expect(bindUrl.status).toBe(200);
      const bindState = new URL(bindUrl.body.url).searchParams.get('state')!;
      const bindCallback = await request(server)
        .get('/api/auth/dingtalk/callback')
        .query({ code: 'bind-code', state: bindState });
      expect(bindCallback.status).toBe(302);
      expect(bindCallback.headers.location).toContain('dingtalk=bound');

      const replay = await request(server)
        .get('/api/auth/dingtalk/callback')
        .query({ code: 'bind-code', state: bindState });
      expect(replay.status).toBe(302);
      expect(replay.headers.location).toContain('dingtalk_error=');

      const loginUrl = await request(server).get('/api/auth/dingtalk/login-url');
      const loginState = new URL(loginUrl.body.url).searchParams.get('state')!;
      const loginCallback = await request(server)
        .get('/api/auth/dingtalk/callback')
        .query({ authCode: 'login-code', state: loginState });
      expect(loginCallback.status).toBe(302);
      const redirect = new URL(loginCallback.headers.location);
      const hash = new URLSearchParams(redirect.hash.slice(1));
      const token = hash.get('dingtalk_token');
      const user = JSON.parse(hash.get('dingtalk_user')!);
      expect(user.username).toBe('receiver01');
      expect(user.dingtalkBound).toBe(true);
      await request(server)
        .get('/api/auth/me')
        .set(auth(token!))
        .expect(200);

      const unbind = await request(server)
        .post('/api/auth/dingtalk/unbind')
        .set(auth(receiverToken));
      expect(unbind.status).toBe(201);
      expect(unbind.body.dingtalkBound).toBe(false);
      expect(exchange).toHaveBeenCalledTimes(2);
    } finally {
      exchange.mockRestore();
      if (oldId === undefined) delete process.env.MES_DINGTALK_CLIENT_ID;
      else process.env.MES_DINGTALK_CLIENT_ID = oldId;
      if (oldSecret === undefined) delete process.env.MES_DINGTALK_CLIENT_SECRET;
      else process.env.MES_DINGTALK_CLIENT_SECRET = oldSecret;
      if (oldOrigin === undefined) delete process.env.MES_PUBLIC_ORIGIN;
      else process.env.MES_PUBLIC_ORIGIN = oldOrigin;
    }
  });
});
