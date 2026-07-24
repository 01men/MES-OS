# MES 仓储管理模块（WMS）前端

金华市聚杰电器 MES 仓储模块前端。Vue 3 + Vite 5 + TypeScript + Vue Router 4 + Pinia + Element Plus + Axios。PDA 页面使用自研移动端样式（不引入 Vant）。

## 快速开始

```bash
npm install        # 源慢时：npm install --registry=https://registry.npmmirror.com
npm run dev        # http://localhost:5173，/api 代理到 http://localhost:3000
npm run build      # vue-tsc 类型检查 + 产物构建
npm run preview
```

## 路由约定（约定优于配置，下游代理必读）

新增页面**只需创建 `.vue` 文件**，路由自动注册，无需改 `src/router/index.ts`：

| 文件位置 | 自动路由 | 默认布局 |
| --- | --- | --- |
| `src/pc/views/dashboard.vue` | `/pc/dashboard` | `pc`（PcLayout） |
| `src/pc/views/inventory/ledger.vue` | `/pc/inventory/ledger` | `pc` |
| `src/pda/views/home.vue` | `/pda/home` | `pda`（PdaLayout） |
| `*/views/**/index.vue` | 父级路径（如 `/pc/inventory`） | 按目录 |

可选：同名 `*.meta.ts` 默认导出 meta（全部字段可选）：

```ts
// src/pda/views/receive.meta.ts
export default {
  title: '收料扫码',   // 菜单名 / 页面标题 / document.title
  perm: 'wms:receive', // 权限码；不填默认所有人可见（渐进开发期建议先不填）
  layout: 'pda'        // 'pc' | 'pda' | 'blank'，一般不用写，按目录自动推断
}
```

- PC 左侧菜单由路由表 `meta.title` 自动生成并按 `perm` 过滤。
- 未匹配路径自动重定向到登录页或角色默认首页。
- 登录后按角色跳转：`PDA_DEFAULT_ROLES`（src/stores/auth.ts，默认 收料员/仓管员/备料员/盘点员）→ `/pda/home`，其余 → `/pc/dashboard`。

## API 调用

```ts
import http from '@/api/http'

// baseURL 已含 /api；自动带 Authorization 与 X-Request-Id；401 自动跳登录；错误统一 ElMessage
const res = await http.get('/materials', { params: { page: 1 } })
await http.post('/receive/scan', { code, taskNo })

// 关闭统一错误提示（自行处理错误时）：
await http.post('/xxx', data, { silent: true } as never)

// 断网场景：入离线队列，online 后自动重放（请求带 X-Task-No，后端按任务号幂等去重）
import { enqueue } from '@/api/offline'
const taskNo = enqueue({ url: '/receive/scan', method: 'post', data: { code } })
```

权限判断：`const auth = useAuthStore(); auth.hasPerm('wms:receive')`（perm 为空恒 true）。

## 公共组件

### ScanInput —— 扫码枪输入框

```vue
<script setup lang="ts">
import ScanInput from '@/components/ScanInput.vue'
function onScan(code: string) { /* 提交扫码 */ }
</script>
<template>
  <ScanInput placeholder="扫描物料条码" @scan="onScan" />
</template>
```

- Props：`placeholder`、`autoRefocus`（默认 true，失焦自动夺回焦点）、`scanInterval`（默认 50ms，低于此间隔判定为扫码枪输入）、`disabled`
- Emits：`scan(code)` —— 回车（扫码枪尾缀）触发并自动清空
- Expose：`focus()`

### ScanFeedback —— 扫码统一反馈（PRD 4.12）

```vue
<ScanFeedback type="success" message="收料成功" />
<ScanFeedback type="duplicate" message="重复扫码" detail="首次：2026-07-24 08:30 / 张三" />
```

- Props：`type`: `'success' | 'error' | 'duplicate' | 'offline'`（绿/红/黄/橙，自带提示音 WebAudio 蜂鸣 + `navigator.vibrate`）、`message`、`detail`（重复扫码时放原扫码时间/人员）、`silent`
- `type/message/detail` 任一变化即重新播报，连续扫同一码也会再次提示。

### PhotoCapture —— 拍照上传

```vue
<PhotoCapture upload-url="/common/upload" storage-key="wms-photo-p06" @uploaded="url => photo = url" @error="msg => ..." />
```

- Props：`maxEdge`（默认 1600，canvas 压缩最长边）、`quality`（默认 0.8）、`uploadUrl`、`autoUpload`（默认 true）、`storageKey`（待传列表持久化 key，**按业务页区分**）
- Emits：`uploaded(url)`、`error(message)`、`pending-change(list)`
- 上传失败自动进待传列表（localStorage），组件内可点重试；文件名为唯一名。

### KeyValueDesc —— 只读描述列表（PC 详情页）

```vue
<KeyValueDesc :column="3" :items="[
  { label: '物料编码', value: row.code },
  { label: '数量', value: row.qty },
  { label: '备注', value: row.remark, span: 2 }
]" />
```

## 如何新增 PDA 页面

1. 建 `src/pda/views/receive.vue`（可选 `receive.meta.ts` 写 `title`），路由 `/pda/receive` 自动生效。
2. 页面根内容放进 `.pda-card`；输入用 `.pda-input` / `ScanInput`；按钮用 `.pda-btn`（56px 高、20px 字号）。
3. 底部主操作栏（固定在 PdaLayout 底部）：

```ts
import { setPdaActions } from '@/layouts/pdaActions'
setPdaActions([{ label: '提交收料', type: 'primary', onClick: submit }])
// 路由切换时布局自动清空，无需手动清理
```

## 目录

```
src/
├── api/http.ts        # Axios 实例（/api、JWT、X-Request-Id、401、统一报错）
├── api/offline.ts     # 离线队列 stub（localStorage + online 重放 + X-Task-No 幂等）
├── components/        # ScanInput / ScanFeedback / PhotoCapture / KeyValueDesc
├── layouts/           # PcLayout / PdaLayout / pdaActions.ts
├── login/LoginView.vue
├── pc/views/          # PC 页面（自动路由）
├── pda/views/         # PDA 页面（自动路由）
├── router/index.ts    # import.meta.glob 自动发现 + 登录守卫 + perm 过滤
├── stores/auth.ts     # token/user 持久化、hasPerm、PDA_DEFAULT_ROLES
└── styles/pda.css     # .pda-btn / .pda-input / 反馈色变量
```
