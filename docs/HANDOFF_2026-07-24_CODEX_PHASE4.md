# Phase 4 开发交接：钉钉配置、1000 场景、Open API、MCP

> 收尾状态：本阶段功能与回归已完成。Kimi K3 接班时先阅读
> `docs/COLLABORATION_STATUS.md`，该文件是后续协作的最新单一入口。

## 本阶段完成

1. 钉钉登录从“只能环境变量配置”升级为 admin 可视化配置；数据库 AES-256-GCM 加密保存 Secret，查询不回传明文，保存写审计。
2. 新增 `npm run seed:volume -- --count=1000`，实际导入 1000 套跨模块关联业务场景，统一模拟录入角色 `receiver01`。
3. 新增 `/api/open/v1`，使用机器 API key、版本化路径、分页、幂等入库和集成客户端审计。
4. 新增独立 `mcp/` 包，提供 stdio 与 Streamable HTTP 两种 transport，共 11 个 MES 工具。
5. 完成构建、单测、真实 API 写入/鉴权/幂等、MCP 协议与工具调用验证。

## 关键文件

- `server/src/modules/auth/dingtalk-config.entity.ts`
- `server/src/modules/auth/dingtalk.service.ts`
- `server/src/modules/openapi/`
- `server/src/seed-volume.ts`
- `web/src/pc/views/ruleconfig/index.vue`
- `mcp/src/`
- `docs/DINGTALK_LOGIN.md`
- `docs/OPEN_API.md`
- `docs/MCP_SERVER.md`
- `docs/TEST_REPORT_INTEGRATION_2026-07-24.md`

## 当前本地运行态

- Web：5173（原开发服务）
- Server：3000，当前进程仅为联调临时设置 `MES_OPEN_API_KEYS=local=test-key`
- MCP：3100，当前进程仅为联调临时 token

临时 key 只存在于进程环境，重启即失效。继续开发前请使用 `.env.example` 指引设置自己的非演示密钥。

## 下一步建议

1. 获得真实钉钉应用信息后完成 HTTPS 回调、首次绑定、已绑定直接登录、解绑后拒绝四条真实链路。
2. 与 U8 顾问确认版本、认证方式、账套、单据字段和增量游标，把 `MockU8Adapter` 换为正式适配器。
3. 为 Open API 增加 OpenAPI/Swagger 机器文档、签名/时间戳防重放和网关级限流。
4. MCP 远程部署增加 OAuth 2.1（现阶段为独立 bearer token）及租户级工具授权。
5. 将 sql.js 迁移 PostgreSQL/MySQL，关闭 `synchronize:true` 并补 migration，再做 1000 场景并发/性能基线。
