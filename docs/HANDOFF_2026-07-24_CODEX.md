# Codex 接棒开发交接记录

时间：2026-07-24 18:49—19:17（Asia/Shanghai）

## 接手基线

截图节点为“集成联调：磁贴路由 / RBAC REST / 契约对齐 + 全量测试”。工作区包含 `server`、`web`、业务会议纪要和 PRD，但没有 `.git`，无法读取 Kimi 的提交历史。

初始验证：

- 后端单测：18/18
- 后端 E2E：54/54
- 后端构建：通过
- 前端构建：通过

## 本轮发现与修复

### 1. RBAC 页面没有后端 REST

前端已调用 `/api/rbac/users|roles|permissions|temp-grants` 和角色分配，但后端只有实体与守卫。本轮新增 `RbacController`、`RbacService`；用户列表移除 `passwordHash`；角色分配支持 ID/code/name；权限变更写入审计日志；新增 `rbac.read/write`。

### 2. 登录权限与前端角色编码不一致

后端返回 `ADMIN/RECEIVER/KEEPER`，前端原来按中文角色判断，且登录响应不含权限码。本轮新增 `perms`，前端识别角色 code 与 `*`，收料员正确落到 `/pda/home`。

### 3. 页面和接口权限未对齐

业务页面原来没有 `meta.perm`，多数新业务控制器也只要求登录。本轮已补齐页面权限。曾尝试按 `GET/HEAD → read、其余方法 → operate` 全局收紧 `prep/surplus/transfer/returns/stocktake/shipping`，但全量 E2E 从 56/56 降至 35/56：现有角色矩阵和服务层领域错误码并不满足这种粗粒度推导，因此已撤回该策略，保留原有显式权限检查。下一阶段应先按接口建立“角色 × 动作 × 数据范围”矩阵，再逐个端点收紧并同步测试。

### 4. PDA 首页存在失效路由

- `/pda/receive` 改为 `/pda/receiving`
- `/pda/leftover` 改为 `/pda/surplus`
- 磁贴按当前权限过滤

### 5. 离线契约不一致

前端冲突处理路径、请求体与后端不一致，且 `X-Task-No` 未真正参与服务端幂等。本轮统一为 `/offline/tasks/:id/resolve` + `KEEP_LOCAL/USE_SERVER`，并在前后端把 `X-Task-No` 归一化为幂等请求号。

### 6. 审计分页与日期契约不一致

后端返回分页对象，前端按数组渲染；`to=YYYY-MM-DD` 只查到当天 00:00。本轮前端改读 `items`，后端把结束日期扩展到本地当天 23:59:59.999。

### 7. 交付可复现性

新增根 README、API 契约、数据字典、操作与运维手册以及一键启动/停止/冒烟脚本。
实际启停验收时发现 Windows 上 `localhost` 可能优先解析到 IPv6，而 Vite 仅监听 `127.0.0.1`，会导致冒烟脚本误判服务未启动；现已统一 Web 探活与文档入口为 `127.0.0.1`。

数据库升级前备份：

`server/data/backups/mes-before-codex-20260724-190125.sqlite`

## 验证证据

最终回归已执行：

- 后端单测：18/18
- 后端构建：通过
- 前端生产构建：通过
- 后端 E2E：56/56（新增 RBAC 与 X-Task-No 用例）
- 冒烟检查：7/7

浏览器实测：

- `admin` → `/pc/dashboard`
- 权限审计页用户/角色数据加载成功
- 保存 `receiver01` 原角色成功并产生 `rbac.user.roles.assign` 审计
- 当天审计记录查询成功
- `receiver01` → `/pda/home`
- 仅显示“收料扫码、离线任务”
- 收料磁贴进入 `/pda/receiving`
- 直接访问 `/pc/security` 被重定向回 `/pda/home`

启停脚本已完成“停止监听 → 重新启动 → 7/7 冒烟”闭环；服务交接时保持运行。

## 变更文件索引

- 后端契约/RBAC：`server/src/modules/rbac/rbac.controller.ts`、`rbac.service.ts`、`rbac.module.ts`、`permission.guard.ts`、`server/src/modules/auth/auth.service.ts`
- 后端幂等/离线/审计：`server/src/common/idempotency/idempotency.interceptor.ts`、`server/src/modules/offline/offline.controller.ts`、`server/src/modules/auditquery/auditquery.controller.ts`
- 种子与回归：`server/src/seed.ts`、`server/test/e2e/app.spec.ts`、`server/test/e2e/stage7.spec.ts`
- 前端契约与状态：`web/src/api/http.ts`、`web/src/api/security2.ts`、`web/src/stores/auth.ts`
- 前端页面：`web/src/pc/views/security/index.vue`、`web/src/pc/views/dashboard.vue`、`web/src/pda/views/home.vue`、`web/src/pda/views/offline/index.vue`
- 路由权限：`web/src/pc/views/**/index.meta.ts`、`web/src/pda/views/**/index.meta.ts`
- 交付材料：`README.md`、`docs/API_CONTRACT.md`、`docs/DATA_DICTIONARY.md`、`docs/OPERATIONS.md`、本记录、`scripts/start-dev.ps1`、`stop-dev.ps1`、`smoke-test.ps1`

## Kimi 下一棒建议

1. 初始化 Git 并确认 PRD、SQLite、上传照片、备份文件的版本策略。
2. 把所有 inline `@Body()` 类型迁移成 class-validator DTO；当前全局 `ValidationPipe` 无法验证 TypeScript 接口。
3. 先形成逐接口角色/动作/数据范围矩阵，再补服务端显式权限；禁止直接按 HTTP 方法全局推导。随后将 receiving/inventory 的旧权限码统一到 `receiving.read/operate` 资源模型，避免权限目录双轨。
4. 完成离线 1000 条压力测试、缓存保护、标签离线唯一号与高风险操作阻断验收。
5. 实现组织/库区/SELF 数据范围；当前 `DataScope` 已建模但查询层未普遍执行。
6. 拆分 Element Plus 主包，当前前端主 chunk 约 1.1 MB。
7. 替换真实 U8 适配器，完成超时、重试、重放、日终对账与 10 秒 SLA 验收。
8. 将 sql.js/`synchronize:true` 迁移为正式数据库 + migration。

## 已知未关闭风险

- 无 Git 历史：本记录是当前主要变更留痕。
- PRD 在本机缺少 LibreOffice，无法完成 DOCX 页面渲染；已通过结构化文本与会议纪要核对需求。
- 当前上传为本机目录；无对象存储、病毒扫描和正式归档。
- 审计为“应用层不提供改删接口”，尚不是 WORM/外部不可篡改日志。
- 多数页面已可运行，但仍需业务人员按 31 项验收清单逐项留证。
