import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory, APP_INTERCEPTOR } from '@nestjs/core';
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
import { IntegrationModule } from '../../src/modules/integration/integration.module';
import { SyncService } from '../../src/modules/integration/sync.service';
import {
  ReceivingModule,
  RECEIVING_ENTITIES,
} from '../../src/modules/receiving/receiving.module';

/**
 * receiving 模块 e2e 专用装配（不动 test/helpers.ts 与 app.spec.ts）：
 * 与 src/app.module.ts 自动发现结果等价 + ReceivingModule 静态注册。
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: [...TEST_ENTITIES, ...RECEIVING_ENTITIES],
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
    ReceivingModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class ReceivingTestAppModule {}

export interface ReceivingTestContext {
  app: INestApplication;
  server: any;
  ds: DataSource;
  adminToken: string;
  receiverToken: string;
}

export async function createReceivingTestApp(): Promise<ReceivingTestContext> {
  const app = await NestFactory.create(ReceivingTestAppModule, { logger: false });
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

  const ds = app.get(DataSource);
  await seedData(ds);
  app.get(SyncService).retryDelaysMs = [5, 10, 15];

  const server = app.getHttpServer();
  const login = async (username: string, password: string) => {
    const res = await request(server).post('/api/auth/login').send({ username, password });
    if (res.status !== 201) throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  };
  const adminToken = await login('admin', 'Admin@123');
  const receiverToken = await login('receiver01', 'Recv@123');
  return { app, server, ds, adminToken, receiverToken };
}
