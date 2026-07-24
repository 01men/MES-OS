# MES-OS 项目协作状态

最后更新：2026-07-24  
当前负责人：Codex  
下一棒：Kimi K3

## 当前结论

Phase 4 已完成，可以继续进入“真实钉钉联调、真实 U8 适配、生产数据库迁移”阶段。当前代码、测试、运行说明和阶段报告均已纳入 Git；本地运行数据与密钥明确排除在版本库之外。

## 已完成能力

| 范围 | 当前状态 | 关键入口 |
|---|---|---|
| WMS 主业务 | 已完成 MVP 链路 | 收料、IQC、库存、备料、余料、调拨、退补料、盘点、发运追溯 |
| RBAC | 已完成 | 11 岗位、临时授权、仓库数据范围、审计 |
| 钉钉登录 | 配置与绑定能力完成 | PC → 规则配置 → 钉钉账号登录 |
| 批量业务数据 | 已导入 | 1000 套 `SIM-*` 跨模块关联场景 |
| 外部服务 API | 已完成 v1 | `/api/open/v1` |
| MCP | 已完成 | `mcp/`，stdio 与 Streamable HTTP |
| U8 | Mock 联调完成 | 正式 U8 Adapter 待真实环境参数 |

## 最终验证基线

- Server TypeScript build：通过
- Server unit：6 个文件、24 项通过
- Server E2E：9 个文件、69 项通过
- 11 岗位 × 3 轮 WMS/RBAC 权限矩阵：通过
- Web Vue 类型检查与 Vite production build：通过
- MCP build：通过
- MCP production dependency audit：0 漏洞
- Open API：正确 key 成功，错误 key 返回 401
- 入库幂等：相同 `X-Request-ID` 返回同一 lot
- MCP 初始化、11 工具发现、`mes_health` 端到端：通过
- `seed:volume` 二次执行：各关联节点仍稳定为 1000

## 本地数据

运行数据库：`server/data/mes.sqlite`  
1000 场景导入前恢复点：`server/data/mes.before-volume-seed-20260724-2109.sqlite`

两者均被 `.gitignore` 排除，不会上传 GitHub。重新构造基础数据：

```powershell
cd server
npm run seed
npm run seed:volume -- --count=1000
```

## 本地服务

| 服务 | 地址 | 启动目录与命令 |
|---|---|---|
| MES Server | `http://127.0.0.1:3000` | `server` → `npm run start:dev` |
| MES Web | `http://127.0.0.1:5173` | `web` → `npm run dev -- --host 0.0.0.0` |
| MES MCP | `http://127.0.0.1:3100/mcp` | `mcp` → `npm run start:http` |

Open API 和 MCP 默认“未配置即关闭”。本地重启时需要在进程环境注入：

```text
MES_OPEN_API_KEYS=<client>=<api-key>
MES_OPEN_API_KEY=<与上面对应的 api-key>
MES_MCP_BEARER_TOKEN=<另一条独立 token>
MES_MCP_ALLOWED_HOSTS=127.0.0.1,localhost
```

不要把实际密钥写入 Git。

## Kimi K3 接手顺序

1. 阅读本文件及 `HANDOFF_2026-07-24_CODEX_PHASE4.md`。
2. 运行 Server unit/E2E、Web build、MCP build，确认环境一致。
3. 向钉钉管理员取得 AppKey/AppSecret 和 HTTPS 公网域名，完成真实授权四链路。
4. 向 U8 顾问确认 U8 版本、账套、认证、单据字段、增量游标和错误码。
5. 实现正式 `U8Adapter`，保持 `/api/open/v1` 契约不变。
6. 生产化前迁移 PostgreSQL/MySQL、关闭 `synchronize:true`、补 migration、限流与备份恢复演练。

## 详细文档

- `DINGTALK_LOGIN.md`
- `OPEN_API.md`
- `MCP_SERVER.md`
- `TEST_REPORT_INTEGRATION_2026-07-24.md`
- `HANDOFF_2026-07-24_CODEX_PHASE4.md`
- `MES_FUNCTION_BLUEPRINT.md`
- `TEST_REPORT_WMS_RBAC_2026-07-24.md`

