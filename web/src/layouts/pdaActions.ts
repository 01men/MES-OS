import { reactive } from 'vue'

/**
 * PDA 底部主操作栏状态。
 * 由于路由页面渲染在 PdaLayout 的默认插槽里，无法直接填具名插槽，
 * 页面通过 setPdaActions() 注册主操作按钮；PdaLayout 在路由切换时自动清空。
 */
export interface PdaAction {
  label: string
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  disabled?: boolean
  onClick: () => void
}

export const pdaActionBar = reactive<{ items: PdaAction[] }>({ items: [] })

export function setPdaActions(items: PdaAction[]) {
  pdaActionBar.items = items
}

export function clearPdaActions() {
  pdaActionBar.items = []
}
