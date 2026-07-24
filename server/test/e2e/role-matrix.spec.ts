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
import {
  DEMO_USERS,
  ROLE_DEFINITIONS,
  seedData,
} from '../../src/seed';
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
import { OfflineTaskQueryModule } from '../../src/modules/offline/offline-task-query.module';
import { IntegrationModule } from '../../src/modules/integration/integration.module';
import { ApprovalcenterModule } from '../../src/modules/approvalcenter/approvalcenter.module';
import { AuditqueryModule } from '../../src/modules/auditquery/auditquery.module';

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
    OfflineTaskQueryModule,
    OfflineModule,
    IntegrationModule,
    ApprovalcenterModule,
    AuditqueryModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class RoleMatrixTestModule {}

const READ_JOURNEYS = [
  { name: '主数据查询', path: '/api/masterdata/materials', permission: 'masterdata.read' },
  { name: '库存台账', path: '/api/inventory/lots', permission: 'inventory.read' },
  { name: 'U8接口监控', path: '/api/integration/logs', permission: 'integration.read' },
  { name: '规则配置', path: '/api/config/rules', permission: 'config.read' },
  { name: '审批中心', path: '/api/approval/todo', permission: 'approval.read' },
  { name: '审计日志', path: '/api/audit/logs', permission: 'audit.read' },
  { name: '离线任务', path: '/api/offline/tasks', permission: 'offline.sync' },
  { name: '权限管理', path: '/api/rbac/users', permission: 'rbac.read' },
] as const;

describe('11 岗位 × 3 轮 WMS/RBAC 权限矩阵', () => {
  let app: INestApplication;
  let server: any;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    app = await NestFactory.create(RoleMatrixTestModule, { logger: false });
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

    for (const user of DEMO_USERS) {
      const login = await request(server)
        .post('/api/auth/login')
        .send({ username: user.username, password: user.password });
      expect(login.status, `登录失败：${user.username}`).toBe(201);
      expect(login.body.user.roles).toEqual([user.role]);
      tokens[user.role] = login.body.token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const expected = (roleCode: string, permission: string) => {
    const role = ROLE_DEFINITIONS.find((item) => item.code === roleCode)!;
    return role.perms.includes('*') || role.perms.includes(permission);
  };

  for (let round = 1; round <= 3; round += 1) {
    it(`第 ${round} 轮：8 个查询旅程的允许/拒绝结果稳定`, async () => {
      for (const user of DEMO_USERS) {
        for (const journey of READ_JOURNEYS) {
          const response = await request(server)
            .get(journey.path)
            .set({ Authorization: `Bearer ${tokens[user.role]}` });
          const shouldAllow = expected(user.role, journey.permission);
          expect(
            response.status,
            `${user.role}/${journey.name} 应${shouldAllow ? '允许' : '拒绝'}`,
          ).toBe(shouldAllow ? 200 : 403);
        }
      }
    });

    it(`第 ${round} 轮：主数据写权限仅仓库主管和管理员可通过守卫`, async () => {
      for (const user of DEMO_USERS) {
        const response = await request(server)
          .post('/api/masterdata/materials')
          .set({ Authorization: `Bearer ${tokens[user.role]}` })
          .send({
            materialCode: `M-R${round}-${user.role}`,
            name: `角色矩阵物料-${round}-${user.role}`,
            unit: 'PCS',
            safetyStock: 0,
          });
        const shouldAllow = expected(user.role, 'masterdata.material.create');
        expect(
          response.status,
          `${user.role}/主数据新建 应${shouldAllow ? '允许' : '拒绝'}`,
        ).toBe(shouldAllow ? 201 : 403);
      }
    });
  }
});

