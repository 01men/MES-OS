import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INestApplication,
  Module,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
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
import { AuditLog } from '../../src/common/audit/audit.entity';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { RbacModule } from '../../src/modules/rbac/rbac.module';
import { MasterdataModule } from '../../src/modules/masterdata/masterdata.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';

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
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class WarehouseScopeTestModule {}

describe('WMS 仓库级数据范围', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  let adminToken: string;
  let keeperToken: string;
  const scopeChangeRequestId = 'scope-change-replay';

  const login = async (username: string, password: string) => {
    const response = await request(server)
      .post('/api/auth/login')
      .send({ username, password });
    expect(response.status).toBe(201);
    return response.body.token as string;
  };

  const inbound = (
    token: string,
    requestId: string,
    packageNo: string,
    warehouseCode: string,
    locationCode: string,
  ) =>
    request(server)
      .post('/api/inventory/inbound')
      .set({
        Authorization: `Bearer ${token}`,
        'X-Request-Id': requestId,
      })
      .send({
        packageNo,
        materialCode: 'M-1001',
        batchNo: `B-${packageNo}`,
        qty: 10,
        warehouseCode,
        locationCode,
        sourceDocNo: `SRC-${packageNo}`,
      });

  beforeAll(async () => {
    app = await NestFactory.create(WarehouseScopeTestModule, { logger: false });
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
    adminToken = await login('admin', 'Admin@123');
    keeperToken = await login('keeper01', 'Keep@123');

    expect(
      (await inbound(
        adminToken,
        'scope-seed-wh02',
        'PKG-SCOPE-WH02',
        'WH02',
        'WH02-C-01',
      )).status,
    ).toBe(201);
    expect(
      (await inbound(
        adminToken,
        'scope-seed-move',
        'PKG-SCOPE-MOVE',
        'WH01',
        'WH01-A-01',
      )).status,
    ).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('仓管员列表自动过滤为已授权的 WH01', async () => {
    const response = await request(server)
      .get('/api/inventory/lots')
      .set({ Authorization: `Bearer ${keeperToken}` });
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(new Set(response.body.map((row: any) => row.warehouseCode))).toEqual(
      new Set(['WH01']),
    );
  });

  it('显式查询或写入 WH02 均返回 403，幂等重放也不能绕过范围校验', async () => {
    const query = await request(server)
      .get('/api/inventory/lots?warehouseCode=WH02')
      .set({ Authorization: `Bearer ${keeperToken}` });
    expect(query.status).toBe(403);
    expect(query.body.code).toBe('WAREHOUSE_SCOPE_FORBIDDEN');

    const sharedRequestId = 'scope-idem-replay';
    const created = await inbound(
      adminToken,
      sharedRequestId,
      'PKG-SCOPE-IDEM',
      'WH02',
      'WH02-C-01',
    );
    expect(created.status).toBe(201);
    const replay = await inbound(
      keeperToken,
      sharedRequestId,
      'PKG-SCOPE-IDEM',
      'WH02',
      'WH02-C-01',
    );
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe('WAREHOUSE_SCOPE_FORBIDDEN');

    const beforeScopeChange = await inbound(
      keeperToken,
      scopeChangeRequestId,
      'PKG-SCOPE-BEFORE-CHANGE',
      'WH01',
      'WH01-A-01',
    );
    expect(beforeScopeChange.status).toBe(201);
    expect(beforeScopeChange.body.warehouseCode).toBe('WH01');
  });

  it('跨仓移库受源仓与目标仓双重校验，管理员操作后仓库编码与库位保持一致', async () => {
    const denied = await request(server)
      .post('/api/inventory/move')
      .set({
        Authorization: `Bearer ${keeperToken}`,
        'X-Request-Id': 'scope-move-denied',
      })
      .send({
        packageNo: 'PKG-SCOPE-MOVE',
        toLocation: 'WH02-C-01',
        docNo: 'MOVE-SCOPE-1',
      });
    expect(denied.status).toBe(403);

    const moved = await request(server)
      .post('/api/inventory/move')
      .set({
        Authorization: `Bearer ${adminToken}`,
        'X-Request-Id': 'scope-move-admin',
      })
      .send({
        packageNo: 'PKG-SCOPE-MOVE',
        toLocation: 'WH02-C-01',
        docNo: 'MOVE-SCOPE-2',
      });
    expect(moved.status).toBe(201);
    expect(moved.body.warehouseCode).toBe('WH02');
    expect(moved.body.locationCode).toBe('WH02-C-01');
  });

  it('管理员可调整用户仓库范围，旧 JWT 在下一请求即时按新范围生效并记录审计', async () => {
    const users = await request(server)
      .get('/api/rbac/users')
      .set({ Authorization: `Bearer ${adminToken}` });
    const keeper = users.body.find((user: any) => user.username === 'keeper01');

    const invalid = await request(server)
      .post(`/api/rbac/users/${keeper.id}/warehouses`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ warehouseCodes: ['NOT-EXISTS'] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('RBAC_WAREHOUSE_NOT_FOUND');

    const assigned = await request(server)
      .post(`/api/rbac/users/${keeper.id}/warehouses`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ warehouseCodes: ['wh02', 'WH02'] });
    expect(assigned.status).toBe(201);
    expect(assigned.body.warehouseCodes).toEqual(['WH02']);

    const afterScopeChange = await inbound(
      keeperToken,
      scopeChangeRequestId,
      'PKG-SCOPE-AFTER-CHANGE',
      'WH02',
      'WH02-C-01',
    );
    expect(afterScopeChange.status).toBe(201);
    expect(afterScopeChange.body.packageNo).toBe('PKG-SCOPE-AFTER-CHANGE');
    expect(afterScopeChange.body.warehouseCode).toBe('WH02');

    const wh02 = await request(server)
      .get('/api/inventory/lots?warehouseCode=WH02')
      .set({ Authorization: `Bearer ${keeperToken}` });
    expect(wh02.status).toBe(200);
    expect(wh02.body.every((row: any) => row.warehouseCode === 'WH02')).toBe(true);

    const wh01 = await request(server)
      .get('/api/inventory/lots?warehouseCode=WH01')
      .set({ Authorization: `Bearer ${keeperToken}` });
    expect(wh01.status).toBe(403);

    const audit = await ds.getRepository(AuditLog).findOne({
      where: {
        action: 'rbac.user.warehouses.assign',
        docNo: 'keeper01',
      },
      order: { id: 'DESC' },
    });
    expect(audit?.operator).toBe('admin');
    expect(audit?.after).toContain('WH02');
  });
});
