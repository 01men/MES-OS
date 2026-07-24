import 'reflect-metadata';
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
import { PREP_ENTITIES, PrepModule } from '../../src/modules/prep/prep.module';

/** prep 测试实体清单 = 共享清单 + prep 模块实体（不改 test/helpers.ts） */
export const PREP_TEST_ENTITIES = [...TEST_ENTITIES, ...PREP_ENTITIES];

/** prep e2e 根模块：静态装配（等价 app.module 自动发现 + PrepModule） */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: PREP_TEST_ENTITIES,
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
    PrepModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class PrepTestAppModule {}

export interface PrepTestContext {
  app: INestApplication;
  server: any;
  ds: DataSource;
  tokens: Record<string, string>;
}

/** 启动完整 App + 种子数据 + 登录 admin/keeper01/receiver01 */
export async function createPrepTestApp(): Promise<PrepTestContext> {
  const app = await NestFactory.create(PrepTestAppModule, { logger: false });
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
  const server = app.getHttpServer();
  const ds = app.get(DataSource);
  await seedData(ds);
  app.get(SyncService).retryDelaysMs = [5, 10, 15];

  const tokens: Record<string, string> = {};
  for (const [username, password] of [
    ['admin', 'Admin@123'],
    ['keeper01', 'Keep@123'],
    ['receiver01', 'Recv@123'],
  ] as const) {
    const res = await request(server).post('/api/auth/login').send({ username, password });
    if (res.status !== 201) throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
    tokens[username] = res.body.token;
  }
  return { app, server, ds, tokens };
}
