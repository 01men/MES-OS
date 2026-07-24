import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { Component } from 'vue'
import { useAuthStore } from '@/stores/auth'
import LoginView from '@/login/LoginView.vue'

/** 页面 meta 约定：同名 *.meta.ts 默认导出此对象（全部可选） */
export interface ViewMeta {
  /** 菜单/标题文案 */
  title?: string
  /** 权限码；为空则默认可见 */
  perm?: string
  /** 布局：默认按目录推断（pc/views → pc，pda/views → pda），可覆盖 */
  layout?: 'pc' | 'pda' | 'blank'
}

declare module 'vue-router' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface RouteMeta extends ViewMeta {}
}

/* ---------- 约定优于配置：自动发现页面 ---------- */
const pcViews = import.meta.glob('../pc/views/**/*.vue')
const pdaViews = import.meta.glob('../pda/views/**/*.vue')
const pcMetas = import.meta.glob('../pc/views/**/*.meta.ts', {
  eager: true,
  import: 'default'
}) as Record<string, ViewMeta>
const pdaMetas = import.meta.glob('../pda/views/**/*.meta.ts', {
  eager: true,
  import: 'default'
}) as Record<string, ViewMeta>

function buildRoutes(
  views: Record<string, () => Promise<Component>>,
  metas: Record<string, ViewMeta>,
  base: '/pc' | '/pda'
): RouteRecordRaw[] {
  return Object.keys(views).map((file) => {
    // ../pc/views/inventory/ledger.vue → inventory/ledger
    const rel = file.replace(/^\.\.\/(pc|pda)\/views\//, '').replace(/\.vue$/, '')
    const meta = metas[file.replace(/\.vue$/, '.meta.ts')] ?? {}
    // index.vue → 父级路径
    const sub = rel.replace(/(^|\/)index$/, '')
    return {
      path: sub ? `${base}/${sub}` : base,
      name: `${base.slice(1)}-${rel.replace(/\//g, '-')}`,
      component: views[file],
      meta: { layout: base.slice(1), ...meta } as ViewMeta
    } as RouteRecordRaw
  })
}

function defaultHome(): string {
  const auth = useAuthStore()
  if (!auth.isLoggedIn) return '/login'
  return auth.isPdaUser ? '/pda/home' : '/pc/dashboard'
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { title: '登录', layout: 'blank' } },
  ...buildRoutes(pcViews as Record<string, () => Promise<Component>>, pcMetas, '/pc'),
  ...buildRoutes(pdaViews as Record<string, () => Promise<Component>>, pdaMetas, '/pda'),
  { path: '/', redirect: () => defaultHome() },
  { path: '/:pathMatch(.*)*', redirect: () => defaultHome() }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.path === '/login') {
    return auth.isLoggedIn ? defaultHome() : true
  }
  if (!auth.isLoggedIn) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  // perm 过滤：meta.perm 非空且无权限时不放行
  if (to.meta.perm && !auth.hasPerm(to.meta.perm)) {
    return defaultHome()
  }
  return true
})

router.afterEach((to) => {
  if (to.meta.title) document.title = `${to.meta.title} - 聚杰电器 MES`
})

export default router
