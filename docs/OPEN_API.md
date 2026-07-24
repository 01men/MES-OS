# MES Open API v1

基地址：`http://127.0.0.1:3000/api/open/v1`

所有接口必须携带：

```http
X-MES-API-Key: <client key>
Content-Type: application/json
```

服务端变量采用逗号分隔的客户端键值：

```text
MES_OPEN_API_KEYS=u8=<long-random-key>,crm=<another-key>
```

未设置该变量时，全部 Open API 返回 503。无密钥或错误密钥返回 401。写操作的审计操作人为 `integration:<client-name>`。

## 接口清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 接入健康检查 |
| GET | `/materials?page=1&pageSize=50` | 物料主数据分页 |
| PUT | `/materials/:materialCode` | 物料 upsert |
| GET | `/inventory/lots` | 库存批次分页，可筛物料/仓库/状态 |
| GET | `/inventory/available/:materialCode` | 查询可用量 |
| POST | `/inventory/inbound` | 幂等入库 |
| POST | `/purchase-orders/import` | U8 采购单头/行 upsert |
| GET | `/receiving/arrivals` | 收料/IQC 记录分页 |
| POST | `/delivery-notes/import` | U8 发货通知头/行 upsert |
| POST | `/sync/tasks` | 创建并执行 U8 同步任务 |
| GET | `/sync/tasks` | 同步任务分页 |

分页最大 `pageSize=200`。

## 幂等入库示例

```http
POST /api/open/v1/inventory/inbound
X-MES-API-Key: ...
X-Request-ID: u8-receive-20260724-001

{
  "packageNo": "PKG-U8-0001",
  "materialCode": "M-1001",
  "batchNo": "LOT-U8-0001",
  "qty": 12,
  "warehouseCode": "WH01",
  "locationCode": "WH01-A-01",
  "sourceDocNo": "PO-U8-0001"
}
```

相同 `X-Request-ID` 重放会返回首次结果，不重复增加库存。采购单、发货单以外部单号为幂等键，重复导入更新头信息并重建明细。

## 上线约束

- API key 仅放在服务端密钥管理系统，不写入前端、仓库或日志。
- 公网入口必须使用 HTTPS，并通过网关增加 IP 白名单、限流和请求体大小限制。
- 当前 U8 Adapter 是 Mock；接真实 U8 时只替换适配器，Open API 契约保持不变。
- v1 已发布字段不做破坏性修改；不兼容变更新开 `/open/v2`。

