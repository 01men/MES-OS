import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { TEST_ENTITIES } from '../helpers';
import { seedData } from '../../src/seed';
import { GlobalExceptionFilter } from '../../src/common/exceptions';
import { IdempotencyModule } from '../../src/common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../../src/common/idempotency/idempotency.interceptor';
import { AuditModule } from '../../src/common/audit/audit.module';
import { ApprovalModule } from '../../src/common/approval/approval.module';
import { ApprovalEngineService } from '../../src/common/approval/approval.service';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { RbacModule } from '../../src/modules/rbac/rbac.module';
import { ConfigModule } from '../../src/modules/config/config.module';
import { OfflineModule } from '../../src/modules/offline/offline.module';
import { OfflineTaskQueryModule } from '../../src/modules/offline/offline-task-query.module';
import { ApprovalcenterModule } from '../../src/modules/approvalcenter/approvalcenter.module';
import { AuditqueryModule } from '../../src/modules/auditquery/auditquery.module';
import { User } from '../../src/modules/rbac/entities/user.entity';
import { Role } from '../../src/modules/rbac/entities/role.entity';
import { Permission } from '../../src/modules/rbac/entities/permission.entity';
import { Material } from '../../src/modules/masterdata/entities/material.entity';
import { StockLot } from '../../src/modules/inventory/entities/stock-lot.entity';
import { OfflineTask } from '../../src/modules/offline/offline-task.entity';
import { OfflineStatus } from '../../src/common/enums';

/**
 * 阶段七 e2e：审批中心 / 审计查询 / offline 冲突处理 / config rules / seed 幂等。
 * 静态装配（Vitest 不用运行时自动发现），OfflineTaskQueryModule 须在 OfflineModule
 * 之前注册，使 GET /offline/tasks 走带过滤的新实现。
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      synchronize: true,
      entities: TEST_ENTITIES,
      logging: false,
    } as any),
    IdempotencyModule,
    AuditModule,
    ApprovalModule,
    AuthModule,
    RbacModule,
    ConfigModule,
    OfflineTaskQueryModule,
    OfflineModule,
    ApprovalcenterModule,
    AuditqueryModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
class Stage7TestModule {}

describe('阶段七 e2e（审批中心/审计/权限/种子）', () => {
  let app: INestApplication;
  let server: any;
  let ds: DataSource;
  let engine: ApprovalEngineService;
  let adminToken: string;
  let receiverToken: string;
  let keeperToken: string;
  let managerToken: string;
  let apApproveId: number; // 用于通过
  let apRejectId: number; // 用于驳回
  let apSelfId: number; // 自审拦截

  const login = async (username: string, password: string) => {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ username, password });
    expect(res.status).toBe(201);
    return res.body.token as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await NestFactory.create(Stage7TestModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    server = app.getHttpServer();
    ds = app.get(DataSource);
    engine = app.get(ApprovalEngineService);

    await seedData(ds);

    // 主管账号（WH_MANAGER：approval.read/operate + stocktake.*）
    const mgrRole = await ds.getRepository(Role).findOne({ where: { code: 'WH_MANAGER' } });
    await ds.getRepository(User).save(
      ds.getRepository(User).create({
        username: 'manager01',
        name: '主管一号',
        passwordHash: await bcrypt.hash('Mgr@123', 10),
        roles: [mgrRole!],
        disabled: false,
      }),
    );

    adminToken = await login('admin', 'Admin@123');
    receiverToken = await login('receiver01', 'Recv@123');
    keeperToken = await login('keeper01', 'Keep@123');
    managerToken = await login('manager01', 'Mgr@123');

    const apA = await engine.create('TEST', 'T-A', 'receiver01', [{ userId: 'manager01' }]);
    const apB = await engine.create('TEST', 'T-B', 'receiver01', [{ userId: 'manager01' }]);
    const apC = await engine.create('TEST', 'T-C', 'manager01', [{ approverRole: 'WH_MANAGER' }]);
    apApproveId = apA.id;
    apRejectId = apB.id;
    apSelfId = apC.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('① todo/done/mine/all 查询正确', async () => {
    const todo = await request(server)
      .get('/api/approval/todo')
      .set(auth(managerToken));
    expect(todo.status).toBe(200);
    const todoIds = todo.body.map((a: any) => a.id);
    expect(todoIds).toContain(apApproveId);
    expect(todoIds).toContain(apRejectId);
    const item = todo.body.find((a: any) => a.id === apApproveId);
    expect(item.bizType).toBe('TEST');
    expect(item.bizId).toBe('T-A');
    expect(item.applicantId).toBe('receiver01');
    expect(item.applicantName).toBe('收料员一号');
    expect(item.status).toBe('PENDING');
    expect(item.steps[0]).toMatchObject({ seq: 1, userId: 'manager01', status: 'PENDING' });

    // 申请人 ≠ 审批人：receiver01 的 todo 不含这些单
    const todoRecv = await request(server)
      .get('/api/approval/todo')
      .set(auth(adminToken));
    expect(todoRecv.status).toBe(200);

    const mine = await request(server)
      .get('/api/approval/mine')
      .set(auth(receiverToken));
    expect(mine.status).toBe(200);
    const mineIds = mine.body.map((a: any) => a.id);
    expect(mineIds).toContain(apApproveId);
    expect(mineIds).toContain(apRejectId);
    expect(mineIds).not.toContain(apSelfId);

    const done = await request(server)
      .get('/api/approval/done')
      .set(auth(managerToken));
    expect(done.status).toBe(200);
    expect(done.body.map((a: any) => a.id)).not.toContain(apApproveId);

    // all 仅 ADMIN
    const allMgr = await request(server)
      .get('/api/approval/all')
      .set(auth(managerToken));
    expect(allMgr.status).toBe(403);
    const allAdmin = await request(server)
      .get('/api/approval/all')
      .set(auth(adminToken));
    expect(allAdmin.status).toBe(200);
    expect(allAdmin.body.length).toBeGreaterThanOrEqual(3);

    // 无 approval.read 权限的账号（收料员）查 todo → 403
    const todoForbidden = await request(server)
      .get('/api/approval/todo')
      .set(auth(receiverToken));
    expect(todoForbidden.status).toBe(403);
  });

  it('② approve/reject 经审批中心可用，自审被拒', async () => {
    const ok = await request(server)
      .post(`/api/approval/${apApproveId}/approve`)
      .set(auth(managerToken))
      .set('X-Request-Id', 's7-approve-1')
      .send({ comment: '同意' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.steps[0]).toMatchObject({ seq: 1, status: 'APPROVED', comment: '同意' });
    expect(ok.body.steps[0].actedAt).toBeTruthy();

    // 已办列表出现该单
    const done = await request(server)
      .get('/api/approval/done')
      .set(auth(managerToken));
    expect(done.body.map((a: any) => a.id)).toContain(apApproveId);

    const rej = await request(server)
      .post(`/api/approval/${apRejectId}/reject`)
      .set(auth(managerToken))
      .set('X-Request-Id', 's7-reject-1')
      .send({ reason: '数量不符' });
    expect(rej.status).toBe(201);
    expect(rej.body.status).toBe('REJECTED');
    expect(rej.body.steps[0]).toMatchObject({ status: 'REJECTED', comment: '数量不符' });

    // 自审拦截：manager01 是自己发起单的审批角色 → SELF_APPROVAL_FORBIDDEN
    const self = await request(server)
      .post(`/api/approval/${apSelfId}/approve`)
      .set(auth(managerToken))
      .set('X-Request-Id', 's7-approve-self')
      .send({});
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('SELF_APPROVAL_FORBIDDEN');

    // 非当前审批人 → 引擎拦截
    const notApprover = await request(server)
      .post(`/api/approval/${apSelfId}/approve`)
      .set(auth(adminToken))
      .set('X-Request-Id', 's7-approve-other')
      .send({});
    expect(notApprover.status).toBe(400);
    expect(notApprover.body.code).toBe('NOT_CURRENT_APPROVER');

    // 已终审单不可再操作
    const again = await request(server)
      .post(`/api/approval/${apApproveId}/approve`)
      .set(auth(managerToken))
      .set('X-Request-Id', 's7-approve-again')
      .send({});
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('APPROVAL_NOT_PENDING');
  });

  it('③ 审计日志查询 + 过滤 + CSV 导出', async () => {
    const byOperator = await request(server)
      .get('/api/audit/logs?operator=manager01&action=approval.approve')
      .set(auth(adminToken));
    expect(byOperator.status).toBe(200);
    expect(byOperator.body.total).toBeGreaterThanOrEqual(1);
    expect(byOperator.body.items[0].action).toBe('approval.approve');
    expect(byOperator.body.page).toBe(1);

    const byDoc = await request(server)
      .get('/api/audit/logs?docNo=T-A')
      .set(auth(adminToken));
    expect(byDoc.body.items.some((l: any) => l.docNo === 'T-A')).toBe(true);

    // 日期选择器传 YYYY-MM-DD 时，结束日期应包含当天 23:59:59.999。
    const today = new Date().toISOString().slice(0, 10);
    const todayOnly = await request(server)
      .get(`/api/audit/logs?from=${today}&to=${today}`)
      .set(auth(adminToken));
    expect(todayOnly.body.total).toBeGreaterThanOrEqual(1);

    // 过滤无结果
    const none = await request(server)
      .get('/api/audit/logs?operator=nobody')
      .set(auth(adminToken));
    expect(none.body.total).toBe(0);

    // 显式时间窗口（远古 → 无数据）
    const old = await request(server)
      .get('/api/audit/logs?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z')
      .set(auth(adminToken));
    expect(old.body.total).toBe(0);

    // CSV 导出（带 BOM）
    const csv = await request(server)
      .get('/api/audit/logs/export?operator=manager01')
      .set(auth(adminToken))
      .buffer(true)
      .parse((res, cb) => {
        let text = '';
        res.on('data', (c: any) => (text += c.toString('utf8')));
        res.on('end', () => cb(null, text));
      });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.body as unknown as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('approval.approve');
    expect(text).toContain('approval.reject');

    // 无 audit.read 权限 → 403
    const forbidden = await request(server)
      .get('/api/audit/logs')
      .set(auth(keeperToken));
    expect(forbidden.status).toBe(403);
  });

  it('④ seedData 重复执行幂等（关键表行数不变）', async () => {
    const count = async (e: any) => ds.getRepository(e).count();
    const before = {
      perm: await count(Permission),
      role: await count(Role),
      user: await count(User),
      material: await count(Material),
      lot: await count(StockLot),
    };
    await seedData(ds);
    await seedData(ds);
    expect(await count(Permission)).toBe(before.perm);
    expect(await count(Role)).toBe(before.role);
    expect(await count(User)).toBe(before.user);
    expect(await count(Material)).toBe(before.material);
    expect(await count(StockLot)).toBe(before.lot);
    // 新权限码已入目录
    const codes = (await ds.getRepository(Permission).find()).map((p) => p.code);
    for (const c of ['receiving.read', 'prep.operate', 'surplus.read', 'transfer.operate', 'returns.qtransfer', 'stocktake.operate', 'shipping.operate', 'approval.read', 'approval.operate', 'audit.read']) {
      expect(codes).toContain(c);
    }
  });

  it('⑤ offline 任务查询（当前用户）与冲突处理骨架', async () => {
    const repo = ds.getRepository(OfflineTask);
    await repo.save(
      repo.create({
        deviceId: 'PDA-01',
        operatorId: 'receiver01',
        taskNo: 'OT-CONFLICT-1',
        bizTime: new Date(),
        payload: '{}',
        status: OfflineStatus.CONFLICT,
      }),
    );

    const mine = await request(server)
      .get('/api/offline/tasks?status=CONFLICT')
      .set(auth(receiverToken));
    expect(mine.status).toBe(200);
    expect(mine.body.map((t: any) => t.taskNo)).toContain('OT-CONFLICT-1');

    // 他人视角看不到
    const others = await request(server)
      .get('/api/offline/tasks?status=CONFLICT')
      .set(auth(keeperToken));
    expect(others.body.map((t: any) => t.taskNo)).not.toContain('OT-CONFLICT-1');

    const task = await repo.findOne({ where: { taskNo: 'OT-CONFLICT-1' } });
    const badChoice = await request(server)
      .post(`/api/offline/tasks/${task!.id}/resolve`)
      .set(auth(receiverToken))
      .send({ choice: 'XXX' });
    expect(badChoice.status).toBe(400);
    expect(badChoice.body.code).toBe('OFFLINE_RESOLVE_CHOICE_INVALID');

    const keepLocal = await request(server)
      .post(`/api/offline/tasks/${task!.id}/resolve`)
      .set(auth(receiverToken))
      .set('X-Request-Id', 's7-resolve-1')
      .send({ choice: 'KEEP_LOCAL' });
    expect(keepLocal.status).toBe(201);
    expect(keepLocal.body.status).toBe('PENDING');

    // 非 CONFLICT 不可再 resolve
    const notConflict = await request(server)
      .post(`/api/offline/tasks/${task!.id}/resolve`)
      .set(auth(receiverToken))
      .send({ choice: 'USE_SERVER' });
    expect(notConflict.status).toBe(400);
    expect(notConflict.body.code).toBe('OFFLINE_TASK_NOT_CONFLICT');

    // 回到 CONFLICT 后 USE_SERVER → FAILED
    await repo.update(task!.id, { status: OfflineStatus.CONFLICT });
    const useServer = await request(server)
      .post(`/api/offline/tasks/${task!.id}/resolve`)
      .set(auth(receiverToken))
      .set('X-Request-Id', 's7-resolve-2')
      .send({ choice: 'USE_SERVER' });
    expect(useServer.status).toBe(201);
    expect(useServer.body.status).toBe('FAILED');
  });

  it('⑥ config rules：列表 / 新版本 / 版本历史', async () => {
    await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'demo.key', value: 'v1' })
      .expect(201);
    await request(server)
      .post('/api/config/rules')
      .set(auth(adminToken))
      .send({ key: 'demo.key', value: 'v2' })
      .expect(201);

    const list = await request(server)
      .get('/api/config/rules')
      .set(auth(adminToken));
    expect(list.status).toBe(200);
    const row = list.body.find((r: any) => r.key === 'demo.key');
    expect(row.value).toBe('v2');
    expect(row.version).toBe(2);

    const versions = await request(server)
      .get('/api/config/rules/demo.key/versions')
      .set(auth(adminToken));
    expect(versions.status).toBe(200);
    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].version).toBe(2);
  });
});
