# MES WMS 操作与运维手册

更新日期：2026-07-24

## 环境要求

- Windows PowerShell 5.1+
- Node.js 18+（建议 20 LTS）
- npm 9+
- 当前 MVP 无需外部数据库服务

## 初始化

```powershell
cd server
npm install
npm run seed

cd ..\web
npm install
```

权限目录或角色定义变化后必须重新执行 `server\npm run seed`。`seedData` 为幂等更新，不会清空业务表。

## 启停

```powershell
.\scripts\start-dev.ps1
.\scripts\stop-dev.ps1
```

启动日志位于 `.runtime\`，PID 文件也保存在该目录。脚本会拒绝占用已有的 3000/5173 端口。

## 冒烟验证

```powershell
.\scripts\smoke-test.ps1
```

检查项：Web 首页、管理员登录、当前用户、RBAC、收料列表、库存台账、集成日志、Mock U8。

完整验证：

```powershell
cd server
npm run build
npm test
npm run test:e2e

cd ..\web
npm run build
```

## 数据与备份

数据库文件：`server\data\mes.sqlite`。

手工备份前先停止后端：

```powershell
.\scripts\stop-dev.ps1
Copy-Item .\server\data\mes.sqlite .\server\data\backups\mes-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite
```

恢复时同样先停后端，再用已验证备份覆盖数据库。恢复后执行冒烟脚本，并抽查库存、接口日志与 U8 对账。

## 环境变量

| 变量 | 必须性 | 说明 |
| --- | --- | --- |
| `MES_JWT_SECRET` | 生产必须 | JWT 签名密钥，禁止使用仓库默认值 |

生产密钥不得写入仓库、日志、测试数据或交接文档。

## 常见故障

### 3000/5173 被占用

```powershell
Get-NetTCPConnection -LocalPort 3000,5173 -State Listen |
  Select-Object LocalPort,OwningProcess
```

确认进程归属后再停止，不要盲目结束不相关进程。

### 登录后菜单为空或落点错误

1. 重新执行 `npm run seed`。
2. 重新登录，确保登录响应含 `roles` 与 `perms`。
3. 检查页面 `*.meta.ts` 的 `perm` 是否与后端权限码一致。

### U8 同步失败

1. 查看 `/api/integration/logs` 的业务键、请求号、重试次数与最终状态。
2. 检查 `u8.mockFailure` 规则是否误开。
3. 故障恢复后使用受控重放，随后执行 `/api/integration/reconcile`。

### 离线任务重复

客户端重放必须沿用同一个 `X-Task-No`。服务端会把它作为幂等请求号；不要在每次重试时重新生成任务号。

## 生产上线限制

- 当前 sql.js 仅适合单机试点，不支持多实例并发。
- `synchronize:true` 仅限 MVP；生产必须 migration 化。
- U8 为 Mock 适配器，不能视为真实接口验收完成。
- 上传文件位于本地磁盘，生产需补充共享存储、备份、病毒扫描和生命周期策略。
- 日志目前是数据库只读 API，不等同于不可篡改存储；生产需补充归档和访问审计。

