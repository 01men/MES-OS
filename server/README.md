# MES WMS Server（阶段一：公共基础骨架）

金华市聚杰电器 MES 仓储管理模块后端。NestJS 10 + TypeScript + Express + TypeORM(sqljs) + JWT。

## 快速开始

```bash
cd server
npm install
npm run seed        # 初始化数据库 server/data/mes.sqlite + 种子数据
npm run start:dev   # 开发启动（ts-node，端口 3000）
npm run build       # 编译到 dist/
npm start           # 运行 dist/main.js
npm run test        # Vitest 单元测试（test/unit）
npm run test:e2e    # Vitest + Supertest e2e（test/e2e，内存 sqljs 完整 App）
```

- API 全局前缀 `/api`；Mock U8 挂 `/mock-u8`（不走前缀、无需 token）。
- 数据库文件：`server/data/mes.sqlite`（sqljs，`autoSave:true`）。
- 种子账号：`admin/Admin@123`（系统管理员，`*` 权限）、`receiver01/Recv@123`（收料员）、`keeper01/Keep@123`（仓管员）。

> **生产注意**：`synchronize:true` 仅 MVP 阶段允许，生产必须关闭并改用 migration；
> `MES_JWT_SECRET` 环境变量必须覆盖默认密钥；sqljs 单文件库仅适合单机/试点，规模化请换 MySQL 驱动（实体已保持简单，无 sqljs 专有依赖）。

## 目录约定与新模块自动发现

```
src/
├── main.ts / app.module.ts / database.ts / seed.ts
├── common/            # 状态机、编号器、幂等、审计、审批、异常（下游只读）
└── modules/           # 业务模块：auth / rbac / masterdata / inventory / config / offline / integration
```

**约定优于配置**：`src/app.module.ts` 启动时用 fs 扫描 `src/modules/*/` 下所有
`*.module.ts`，凡导出名为 `*Module` 的类一律动态注册；实体同理扫描
`src/common` 与 `src/modules` 下所有 `*.entity.ts`（`src/database.ts`）。
下游业务代理（receiving/prep/surplus/transfer/returns/stocktake/shipping）只需：

1. 新建 `src/modules/<你的模块>/` 目录；
2. 在其中放 `xxx.module.ts`（导出 `XxxModule`）与 `*.entity.ts`；
3. **不需要改任何共享文件**，重启即被自动发现。

实体编写约束（重要）：

- **所有 `@Column` 必须显式写 `type`**（如 `@Column({ type: 'varchar' })`）。
  开发运行时（ts-node transpile-only）与测试（SWC）不可靠生成反射元数据，
  缺省类型会在运行期抛 `ColumnTypeUndefinedError`。
- 列类型只用 `varchar / integer / real / text / datetime / boolean`（sqljs 兼容集）。
- 枚举字段用 `varchar` 列 + TS string enum（参考 `StockLot.status`）。

Vitest 测试环境不做运行时扫描：`test/helpers.ts` 维护静态实体清单 `TEST_ENTITIES`，
`test/e2e/app.spec.ts` 静态装配根模块。新模块的测试请在该文件/清单中追加 import。

## 全局机制（所有接口自动生效）

- **认证**：全局 `JwtAuthGuard`，除 `@Public()` 外一律要求 `Authorization: Bearer <token>`。
  登录：`POST /api/auth/login {username,password}` → `{token}`。当前用户注入用 `@CurrentUser()`。
- **鉴权**：`@RequirePerm('xxx.yyy')` + 全局 `PermissionGuard`；无装饰器则只需登录。
  权限 = 角色权限 ∪ 未过期临时授权（`TempGrant.expiresAt` 到期自动失效）；`*` 为超级权限。
- **统一异常**：抛 `BizException(code, message)`，全局过滤器输出 `{code, message, requestId}`。
- **幂等**：写接口必须带请求头 `X-Request-Id`；HTTP 层用 `@Idempotent('biz.key')` 装饰器去重，
  服务层用 `IdempotencyService.execute()`（见下）。
- **审计**：注入 `AuditService` 调 `log()`，`AuditLog` 只增不改（无更新/删除 API）。

## 下游调用契约（只调用，不修改）

### 状态机 `DocStatusMachine`（`src/common/doc-status.machine.ts`）

```ts
DocStatusMachine.canTransition(from: DocStatus, to: DocStatus): boolean
DocStatusMachine.transition(from: DocStatus, to: DocStatus): DocStatus  // 非法迁移抛 BizException
DocStatusMachine.assertEditable(status: DocStatus): void                 // 已 SYNCED 只能 REVERSED
```

链路：`DRAFT→PENDING_APPROVAL→APPROVED→PENDING_SYNC→SYNCED`；异常 `PENDING_SYNC↔SYNC_ERROR`；
终止态 `VOID/REVERSED/COMPLETED`；驳回 `PENDING_APPROVAL→DRAFT`。

### 编号器 `NumberingService`（全局可注入）

```ts
await numbering.next('RCV');           // 'RCV20260724-0001'，按日重置，作废号不复用
await numbering.next('PREP', someDate);// 测试可注入日期
```

### 幂等 `IdempotencyService`（全局可注入）

```ts
const result = await idem.execute(requestId, 'receiving.confirm', async () => {
  /* 真实业务，只会在首次执行 */
});
// 同 (requestId, businessKey) 重放 → 直接返回首次结果
```

HTTP 控制器方法上加 `@Idempotent('biz.key')` 即可获得同样的去重（去重键 = `X-Request-Id` + 业务键）。

### 审计 `AuditService`（全局可注入）

```ts
await audit.log({ operator, role, device, ip, action: 'receiving.confirm',
                  docNo, before: oldObj, after: newObj, result: 'SUCCESS' });
await audit.query({ docNo });  // 只读查询
```

### 审批引擎 `ApprovalEngineService`（全局可注入）

```ts
const ap = await approval.create(bizType, bizId, applicantId, [
  { userId: 'u2' },              // 或 { approverRole: 'WH_MANAGER' }
  { userId: 'u3' },              // 双审批：两步都过才 APPROVED
]);
await approval.approve(ap.id, userId, userRoles, comment?);
await approval.reject(ap.id, userId, userRoles, reason?);   // → REJECTED
await approval.withdraw(ap.id, applicantId);                // 仅申请人
// 硬约束：任何 step 审批人 == 申请人 → create/approve 直接抛 SELF_APPROVAL_FORBIDDEN
```

### 库存 `InventoryService`（`src/modules/inventory/inventory.service.ts`）

```ts
inbound({packageNo, materialCode, batchNo, qty, warehouseCode, locationCode,
         status?, workOrderId?, expiryDate?, sourceDocNo, requestId, operator?}): Promise<StockLot>
changeStatus(packageNo, toStatus: StockStatus, docNo, requestId, operator?): Promise<StockLot>
moveLocation(packageNo, toLocation, docNo, requestId, operator?): Promise<StockLot>
occupy(workOrderId, items: {materialCode, qty}[], prepDocNo, requestId, operator?): Promise<StockOccupation[]>
releaseOccupation(prepDocNo, requestId?, operator?): Promise<number>           // 释放条数
consumeOccupation(prepDocNo, requestId?, operator?): Promise<StockOccupation[]> // 交接出库：占用转 CONSUMED + FIFO 扣实物
adjust(packageNo, newQty, reason, docNo, requestId, operator?): Promise<StockLot>
available(materialCode, warehouseCode?): Promise<{materialCode, qualifiedQty, occupiedQty, safetyStock, available}>
queryLots(filter: {materialCode?, warehouseCode?, locationCode?, status?, batchNo?, workOrderId?}): Promise<StockLot[]>
```

- **可用量公式**：`available = ΣQUALIFIED.qty − ΣACTIVE占用.qty − material.safetyStock`，其余状态一律不计。
- 所有写方法事务化 + `requestId` 幂等（同 requestId 重放返回首次结果，不重复增减）。
- `occupy` 逐物料校验可用量，不足抛 `INSUFFICIENT_AVAILABLE`。
- `consumeOccupation` 扣减顺序：先 STAGING 备料区批次、后 QUALIFIED 批次，按 `receivedAt` 先进先出。
- REST 包装见 `InventoryController`（`/api/inventory/*`，均需 `X-Request-Id`）。

### U8 集成（`src/modules/integration/`）

```ts
// SyncService（业务单据置 PENDING_SYNC 后调用）
await sync.enqueue({ bizType, bizKey, voucherType, payload }); // 成功→SYNCED；失败重试 3 次→SYNC_ERROR+告警
await sync.replay(taskId);   // 人工重放，幂等（已 SYNCED 直接返回）
await sync.logs();
await sync.reconcile();      // 日终对账：{mesSyncedCount, u8VoucherCount, inMesNotU8, inU8NotMes}

// U8Adapter（抽象类，DI 替换点：生产换真实实现）
adapter.pushVoucher(voucherType, payload, bizKey)
adapter.fetchPurchaseOrders(since?) / fetchDeliveryNotes(since?) / fetchMasterData(type) / reportStock()
```

- 故障开关：`POST /api/config/rules {key:'u8.mockFailure', value:'true'}` 后 `pushVoucher` 抛错（测试异常链路用）。
- REST：`POST /api/integration/sync`、`POST /api/integration/replay/:id`、`GET /api/integration/logs`、`POST /api/integration/reconcile`。
- Mock 供给侧：`GET /mock-u8/purchase-orders|delivery-notes|master-data/:type?since=`（公开，模拟 U8 增量拉取）。

### 规则配置 `RuleConfigService`（全局可注入）

```ts
await ruleConfig.get(key);              // 当前生效值
await ruleConfig.set(key, value, operator); // 追加新版本（version+1），不覆盖旧版本
await ruleConfig.history(key);
```

## 常见问题

- **新增实体报 `ColumnTypeUndefinedError`** → 忘了显式写 `@Column({ type: ... })`。
- **`cannot start a transaction within a transaction`** → sqljs 单连接不支持并发事务；
  编号器已内置进程内串行队列，业务写路径请避免在 HTTP 层并发砸同一事务型方法（MVP 可接受）。
- **测试环境模块没被发现** → Vitest 下须把新模块/实体加入 `test/helpers.ts` 与 `test/e2e/app.spec.ts` 的静态清单。
