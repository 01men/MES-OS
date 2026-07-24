# MES WMS API 契约（精简版）

更新日期：2026-07-24

## 通用约定

- API 前缀：`/api`
- Mock U8 前缀：`/mock-u8`，公开且不经过 `/api`
- 认证：`Authorization: Bearer <JWT>`
- 写请求幂等：`X-Request-Id: <unique-id>`
- 幂等缓存按“登录用户 + 当前仓库范围 + 业务键”隔离；请求号不能跨用户复用响应
- 离线重放：可传稳定的 `X-Task-No`；服务端会将其归一化为 `X-Request-Id`
- 成功响应：直接返回业务对象或列表
- 失败响应：`{ code, message, requestId }`
- 401：未登录或 token 失效；403：已登录但缺少权限

登录响应：

```json
{
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "admin",
    "name": "系统管理员",
    "roles": ["ADMIN"],
    "perms": ["*"],
    "warehouseCodes": []
  }
}
```

## 认证与权限

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/login` | 公开 | `{username,password}` |
| GET | `/auth/config` | 公开 | 钉钉登录是否可用；不返回密钥 |
| GET | `/auth/me` | 登录 | 当前用户、角色、权限 |
| GET | `/auth/dingtalk/login-url` | 公开 | 创建一次性 state 并返回钉钉授权 URL |
| GET | `/auth/dingtalk/bind-url` | 登录 | 为当前 MES 用户发起钉钉绑定 |
| GET | `/auth/dingtalk/callback` | 公开 | OAuth 回调；state 十分钟有效且仅消费一次 |
| POST | `/auth/dingtalk/unbind` | 登录 | 当前用户自助解绑，写审计 |
| GET | `/rbac/users` | `rbac.read` | 用户列表，不返回密码摘要 |
| GET | `/rbac/roles` | `rbac.read` | 角色及权限点 |
| GET | `/rbac/permissions` | `rbac.read` | 权限目录 |
| GET | `/rbac/temp-grants` | `rbac.read` | 临时授权及到期时间 |
| POST | `/rbac/users/:userId/roles` | `rbac.write` | `{roles:[roleId或code]}`，写审计日志 |
| POST | `/rbac/users/:userId/warehouses` | `rbac.write` | `{warehouseCodes:["WH01"]}`；去重、校验仓库并写审计 |
| POST | `/rbac/temp-grants` | `rbac.write` | `{userId,permissionCode,expiresAt}`；禁止临时授予 `*` |
| DELETE | `/rbac/temp-grants/:id` | `rbac.write` | 撤销后立即失效并写审计 |
| POST | `/rbac/users/:userId/dingtalk/unbind` | `rbac.write` | 管理员解绑指定用户 |

钉钉服务端配置：`MES_DINGTALK_CLIENT_ID`、`MES_DINGTALK_CLIENT_SECRET`、`MES_PUBLIC_ORIGIN`。公开回调地址必须与钉钉应用登记地址一致。钉钉身份只允许绑定已有 MES 用户；首次出现的 unionId 不会自动创建账号或角色。

权限说明：控制器上声明 `@RequirePerm` 的接口由权限守卫校验；其余业务接口当前主要由登录态及服务层岗位/状态机规则校验。前端 `meta.perm` 仅用于菜单和路由可见性，不能替代服务端授权。

仓库数据范围说明：

- `ADMIN` 或拥有 `DataScope.ALL` 的角色不受仓库范围限制；其他 WMS 岗位按用户的 `warehouseCodes` 过滤。
- 空仓库范围表示不能访问任何仓库；范围变更从下一次请求立即生效，不需要重新签发 JWT。
- 库存、到货单、仓库和库位列表会自动过滤；显式读取或写入未授权仓库返回 `403 / WAREHOUSE_SCOPE_FORBIDDEN`。
- 入库必须校验库位存在且属于指定仓库；跨仓移库同时校验源仓和目标仓，并同步更新批次的仓库编码。

## 审批、审计、规则

| 方法 | 路径 | 权限/说明 |
| --- | --- | --- |
| GET | `/approval/todo` | `approval.read`，待我审批 |
| GET | `/approval/done` | `approval.read`，我已审批 |
| GET | `/approval/mine` | 登录，我发起的 |
| GET | `/approval/all` | `approval.read`，控制器另限制管理员 |
| POST | `/approval/:id/approve` | `approval.operate` |
| POST | `/approval/:id/reject` | `approval.operate` |
| GET | `/audit/logs` | `audit.read`，返回 `{total,page,size,items}` |
| GET | `/audit/logs/export` | `audit.read`，CSV + UTF-8 BOM |
| GET | `/config/rules` | `config.read` |
| GET | `/config/rules/:key/history` | `config.read` |
| POST | `/config/rules` | `config.write`，创建新版本 |

审计日期参数 `from/to=YYYY-MM-DD` 按本地自然日处理，`to` 包含当天 23:59:59.999。

## 收料与库存

| 方法 | 路径 | 关键入参/说明 |
| --- | --- | --- |
| POST | `/receiving/scan` | `{barcode}` |
| POST | `/receiving/orders/sync` | 从 Mock U8 拉取采购订单 |
| GET | `/receiving/orders` | 采购订单 |
| POST | `/receiving/arrivals` | 创建到货暂存，幂等 |
| GET | `/receiving/arrivals` | 可按状态过滤，并自动应用仓库范围 |
| POST | `/receiving/:id/send-inspect` | 送检 |
| POST | `/receiving/:id/iqc` | IQC 判定 |
| POST | `/receiving/:id/confirm` | 确认入库 |
| POST | `/receiving/labels/reprint` | 补打原因必填 |
| GET | `/inventory/lots` | 库存批次查询，自动应用仓库范围 |
| GET | `/inventory/available/:materialCode` | 合格量、占用、安全库存、可用量；支持 `warehouseCode` |
| POST | `/inventory/inbound|move|status|occupy|release|consume|adjust` | 写请求必须带幂等键 |

可用量口径：`QUALIFIED 合格量 - ACTIVE 占用量 - safetyStock`。

## 备料、余料、挪料、退补料

| 资源 | 主要路径 | 前端可见权限 |
| --- | --- | --- |
| 备料 | `/prep/kitting`、`/prep/tasks/*`、`/prep/:id/handover/*` | `prep.read/operate` |
| 余料 | `/surplus`、`/surplus/reminders`、`/surplus/:id/process` | `surplus.read/operate` |
| 挪料 | `/transfer`、`/transfer/todos`、`/transfer/replenish/*`、`/transfer/rework/*` | `transfer.read/operate` |
| 退补料 | `/returns`、`/returns/replenish`、`/returns/writeoffs` | `returns.read/operate` |
| 质量调拨 | `/returns/qtransfers/*` | `returns.qtransfer` |

## 盘点、发运与追溯

| 资源 | 主要路径 | 前端可见权限 |
| --- | --- | --- |
| 盘点策略/任务 | `/stocktake/strategies`、`/stocktake/tasks/*` | `stocktake.read/operate` |
| 冻结/调整 | `/stocktake/:id/freeze`、`unfreeze`、`post-adjustments` | `stocktake.operate` |
| 发货通知 | `/shipping/pull-notes`、`/shipping/notes/*` | `shipping.read/operate` |
| 序列号 | `/shipping/serials` | `shipping.read/operate` |
| 双向追溯 | `/shipping/trace/forward|backward|export` | `shipping.read` |
| 照片 | `/common/upload`、`/common/files/:ym/:name` | `shipping.operate/read` |

## 离线契约

登记离线批次：

```http
POST /api/offline/sync
Authorization: Bearer <token>
X-Task-No: OFF-<timestamp>-<random>
Content-Type: application/json
```

```json
{
  "deviceId": "PDA-01",
  "operatorId": "receiver01",
  "tasks": [
    {
      "taskNo": "OFF-001",
      "bizTime": "2026-07-24T11:00:00Z",
      "payload": {"url": "/receiving/scan", "data": {"barcode": "..."}}
    }
  ]
}
```

返回：`{accepted: string[], duplicated: string[]}`。

冲突处理：

```http
POST /api/offline/tasks/:id/resolve
{"choice":"KEEP_LOCAL"}
```

`choice` 仅允许 `KEEP_LOCAL` 或 `USE_SERVER`。

说明：当前前端本地队列会直接重放原业务请求，高风险审批、过账和发运放行仍必须在线完成。

## U8 集成

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| POST | `/integration/sync` | `integration.replay` |
| POST | `/integration/replay/:id` | `integration.replay` |
| GET | `/integration/logs` | `integration.read` |
| POST | `/integration/reconcile` | `integration.reconcile` |
| GET | `/integration/u8/purchase-orders` | `integration.read` |
| GET | `/integration/u8/delivery-notes` | `integration.read` |
| GET | `/mock-u8/purchase-orders` | 公开，仅开发 |
| GET | `/mock-u8/delivery-notes` | 公开，仅开发 |
| GET | `/mock-u8/master-data/:type` | 公开，仅开发 |
