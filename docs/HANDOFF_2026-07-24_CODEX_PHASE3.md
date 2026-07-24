# Codex 第三阶段开发交接

时间：2026-07-24 19:55—20:29（Asia/Shanghai）

## 本阶段成果

- 将角色 `DataScope` 从占位字段落成 WMS 仓库级数据权限：
  - `WAREHOUSE` 岗位按用户 `warehouseCodes` 访问；
  - `ALL` 角色和超级管理员保持全仓访问；
  - 管理员可在权限页同时分配角色与仓库范围，变更写审计。
- 库存列表、可用量、入库、状态变更、移库、占用、释放、核销和盘点调整均执行仓库校验。
- 到货单列表、详情、送检、IQC、确认入库和标签补打均执行仓库校验。
- 仓库与库位主数据列表自动过滤，未授权的单条读取和写入返回 403。
- 修复跨仓移库一致性缺陷：
  - 目标库位必须存在；
  - 源仓和目标仓均需授权；
  - 移库成功后同时更新 `warehouseCode` 和 `locationCode`。
- 库存占用新增 `warehouseCode`，可用量和核销按仓库归集，避免跨仓占用串账。
- 修复幂等缓存授权边界：缓存键加入用户 ID 与仓库范围指纹，未授权用户不能复用管理员的请求号；用户范围变更后也不会命中旧范围的缓存。
- Vite 增加稳定分包；业务入口 chunk 从约 1.1 MB 降至约 21 KB，Element Plus 独立为可缓存公共 chunk。

## 自动化验证

- 单元测试：20/20。
- E2E：69/69（9 个文件）。
- 原 11 岗位三轮矩阵：297 次授权决策继续通过。
- 新增仓库范围专项：4/4。
- 收料 E2E 增加跨仓隔离用例：8/8。
- 服务端 TypeScript 构建：通过。
- Web 类型检查与生产构建：通过。
- 运行态冒烟：7/7。
- 浏览器验收：权限页 11 个用户均显示预期仓库范围，销售为 `WH02`、仓储/质量岗位为 `WH01`。

## 关键文件

- `server/src/modules/rbac/entities/user.entity.ts`
- `server/src/modules/rbac/rbac.controller.ts`
- `server/src/modules/rbac/rbac.service.ts`
- `server/src/modules/auth/jwt-auth.guard.ts`
- `server/src/modules/inventory/inventory.service.ts`
- `server/src/modules/inventory/entities/stock-occupation.entity.ts`
- `server/src/modules/receiving/receiving.service.ts`
- `server/src/modules/masterdata/masterdata.service.ts`
- `server/test/e2e/warehouse-scope.spec.ts`
- `server/test/e2e/receiving.spec.ts`
- `web/src/pc/views/security/index.vue`
- `web/vite.config.ts`

## 兼容与迁移提醒

1. 运行库仍使用 `synchronize:true`。可回退的旧库为
   `server/data/backups/mes-before-phase2-dingtalk-20260724-1947.sqlite`；
   新结构 seed 后、重启前快照为
   `server/data/backups/mes-phase3-seeded-before-restart-20260724-2023.sqlite`。
2. seed 会把演示岗位的仓库范围同步为：仓储/质量/计划/班组角色 `WH01`，销售 `WH02`，管理员/财务/IT 运维为空数组但其 `ALL` 角色不受限制。
3. 历史占用记录没有仓库归属时，受限用户不能执行释放/核销；管理员可处理。迁移 PostgreSQL 时应根据备料单或来源批次回填。
4. 仓库范围变更不写入 JWT，守卫每次请求重新读取用户，因此旧 token 会即时采用新范围。
5. 新版本 HTTP 幂等业务键带用户/范围命名空间；升级前产生的旧格式幂等记录不会被 HTTP 请求命中。正式迁移时应评估升级窗口内尚未完成的离线任务，避免旧请求号跨版本重放。

## 下一棒

1. 将 sql.js 切换到 PostgreSQL，关闭 `synchronize`，为用户仓库范围和库存占用仓库字段建立正式 migration/backfill。
2. 将数据范围扩展到部门、产线、工单与本人创建的数据，并覆盖生产/质量模块。
3. 获取钉钉企业应用凭据与 HTTPS 回调域名，完成真实扫码、停用、换绑和离职回收验收。
4. 对 Element Plus 改为组件按需引入，并建立首屏性能预算。
