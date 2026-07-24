# 钉钉、开放 API、MCP 与批量数据测试报告

测试时间：2026-07-24  
执行环境：Windows / Node.js / sql.js，本地端口 3000、3100、5173

## 结果摘要

| 范围 | 结果 | 证据 |
|---|---|---|
| 钉钉配置后端 | 通过 | 服务端构建通过；密钥加密/掩码/审计单测通过 |
| 钉钉配置界面 | 通过 | admin 实际进入“规则配置”，可见完整表单、回调地址及配置说明 |
| 单元测试 | 通过 | 6 个文件、24 项测试全部通过 |
| 前端构建 | 通过 | Vue 类型检查及 Vite 生产构建成功 |
| 1000 条业务场景 | 通过 | PO、收料、库存、工单、备料、发货、序列号、U8 同步各 1000 |
| Open API 读 | 通过 | 健康检查返回 ok；物料分页返回正确总数 |
| Open API 写 | 通过 | 采购单导入与库存入库成功 |
| API 幂等 | 通过 | 同一 X-Request-ID 两次入库返回同一 lot id |
| API 鉴权 | 通过 | 错误 API key 返回 HTTP 401 |
| MCP 初始化 | 通过 | 协议协商为 2025-06-18，服务名 mes-os |
| MCP 工具发现 | 通过 | tools/list 返回 11 个工具 |
| MCP → Open API | 通过 | mes_health 经 MCP 调用返回 Open API ok |
| MCP 依赖审计 | 通过 | `npm audit --omit=dev` 为 0 漏洞 |

## 数据关联模型

每个 `SIM-000001`～`SIM-001000` 场景均具备：

`PO-SIM-* → RCV-SIM-* → PKG-SIM-* → WO-SIM-* → PREP-SIM-* → SHP-SIM-* / SN-SIM-* → U8 SyncTask/Voucher`

录入角色为 `receiver01`，仓管交接人为 `keeper01`，导入动作写入 `audit_log`。脚本可重复执行，固定 SIM 命名空间内已存在的节点会跳过，缺失节点会补齐。

## 恢复点

导入前数据库备份：

`server/data/mes.before-volume-seed-20260724-2109.sqlite`

该备份属于运行数据，不应提交到 Git。

## 已知限制

- 当前真实 U8 网络接口尚未提供，因此同步服务仍使用 Mock U8 Adapter。
- 钉钉真实回调必须由企业管理员提供 AppKey/AppSecret 和公网 HTTPS 域名后才能做最终授权验证。
- 前端 Element Plus 主包存在大于 500 kB 的构建告警，不影响功能，后续可继续拆包。
