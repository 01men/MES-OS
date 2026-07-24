# MES MCP 服务

MCP 服务位于 `mcp/`，只调用 MES Open API，不直接读写数据库。这样 AI 客户端与 U8 对接共享同一套鉴权、幂等和审计规则。

## 已开放工具

`mes_health`、`list_materials`、`upsert_material`、`list_inventory_lots`、`get_inventory_available`、`inbound_inventory`、`import_purchase_order`、`import_delivery_note`、`list_receiving_arrivals`、`enqueue_u8_sync`、`list_u8_sync_tasks`。

## 本地 stdio

```powershell
cd mcp
npm install
npm run build
$env:MES_API_BASE_URL="http://127.0.0.1:3000/api/open/v1"
$env:MES_OPEN_API_KEY="<与服务端 MES_OPEN_API_KEYS 对应的 key>"
npm run start:stdio
```

Codex/Claude Desktop 等客户端命令可配置为 `node <绝对路径>/mcp/dist/stdio.js`，并在客户端环境变量中提供 `MES_API_BASE_URL` 与 `MES_OPEN_API_KEY`。

## 远程 Streamable HTTP

```powershell
$env:MES_OPEN_API_KEY="<Open API key>"
$env:MES_MCP_BEARER_TOKEN="<另一条独立的长随机令牌>"
$env:MES_MCP_ALLOWED_HOSTS="mcp.example.com"
$env:MES_MCP_PORT="3100"
npm run start:http
```

端点：`POST http://host:3100/mcp`

客户端请求必须带 `Authorization: Bearer <MES_MCP_BEARER_TOKEN>`。HTTP 模式按请求创建无状态 transport，避免跨客户端状态混用。MCP bearer token 与 MES Open API key 必须是两套不同密钥。

生产环境还应在反向代理设置 TLS、源 IP 白名单、速率限制、最大请求体和访问日志脱敏。

