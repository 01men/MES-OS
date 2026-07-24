# 聚杰电器 MES 仓储管理模块

本仓库包含仓储管理模块的后端、PC/PDA 前端、需求基线与交付文档。

## 当前状态

- 后端：NestJS 10 + TypeORM + sql.js，默认端口 `3000`
- 前端：Vue 3 + Vite + Element Plus，默认端口 `5173`
- 业务：收料/IQC、备料/交接、余料、挪料、退补料、盘点、发运、追溯、审批、审计、规则与接口监控
- 外部系统：U8 当前使用 Mock 适配器，真实 U8 联调尚未完成
- 数据库：`server/data/mes.sqlite`，当前为单机 MVP 方案

## 快速启动

```powershell
.\scripts\start-dev.ps1
.\scripts\smoke-test.ps1
```

浏览器访问：

- PC/PDA 登录页：<http://127.0.0.1:5173/login>
- 后端 API：<http://localhost:3000/api>
- Mock U8：<http://localhost:3000/mock-u8/purchase-orders>

首次运行或权限目录更新后：

```powershell
cd server
npm install
npm run seed

cd ..\web
npm install
```

默认演示账号仅用于本地开发；完整 11 岗位账号见 `server/src/seed.ts`：

- `admin / Admin@123`
- `receiver01 / Recv@123`
- `keeper01 / Keep@123`

## 验证

```powershell
cd server
npm run build
npm test
npm run test:e2e

cd ..\web
npm run build
```

## 文档导航

- [接口契约](docs/API_CONTRACT.md)
- [数据字典](docs/DATA_DICTIONARY.md)
- [操作与运维手册](docs/OPERATIONS.md)
- [Codex 接棒交接记录](docs/HANDOFF_2026-07-24_CODEX.md)
- [第二阶段开发交接](docs/HANDOFF_2026-07-24_CODEX_PHASE2.md)
- [MES 完整功能蓝图](docs/MES_FUNCTION_BLUEPRINT.md)
- [WMS/RBAC 多角色测试报告](docs/TEST_REPORT_WMS_RBAC_2026-07-24.md)
- [后端开发说明](server/README.md)
- [前端开发说明](web/README.md)
- [业务对接会纪要](纪要_WMS模块业务需求对接会.md)

## 生产前硬门槛

1. 当前已初始化本地 Git；推送前确认公开仓库是否允许包含 PRD/会议纪要，并建立受保护主分支。
2. 将 sql.js + `synchronize:true` 替换为正式数据库与 migration。
3. 设置强随机 `MES_JWT_SECRET`，移除演示账号或强制改密。
4. 将 `MockU8Adapter` 替换为经评审的真实 U8 接口适配器并完成对账。
5. 完成离线 1000 条记录、权限数据范围、性能、备份恢复和回退演练。

## 当前自动化基线

- 后端单测：20/20
- 后端 E2E：64/64
- 11 岗位三轮权限矩阵：297 次授权决策通过
- 服务端与 Web 生产构建：通过
