import { defineStore } from 'pinia'

export interface AuthUser {
  id: number | string
  username: string
  name?: string
  roles: string[]
  /** 后端若下发细粒度权限码则存这里（可选） */
  perms?: string[]
}

const TOKEN_KEY = 'wms-token'
const USER_KEY = 'wms-user'

/**
 * 角色 → 默认端 映射（可配置常量）：
 * 命中以下角色的用户登录后默认进入 PDA 端，其余进入 PC 端。
 */
export const PDA_DEFAULT_ROLES: string[] = [
  'RECEIVER',
  'KEEPER',
  'INSPECTOR',
  'LEADER',
  '收料员',
  '仓管员',
  '质检员',
  '生产班组长'
]

/** 超级角色：拥有全部权限 */
export const ADMIN_ROLES: string[] = ['ADMIN', 'admin', '系统管理员']

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: loadUser() as AuthUser | null
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    /** 是否默认进入 PDA 端 */
    isPdaUser: (s) => !!s.user?.roles?.some((r) => PDA_DEFAULT_ROLES.includes(r))
  },
  actions: {
    setAuth(token: string, user: AuthUser) {
      this.token = token
      this.user = user
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    },
    /**
     * 权限码判断。约定：
     * - code 为空（undefined / ''）→ 默认可见（方便渐进开发）
     * - 超级角色 → 全部可见
     * - 否则匹配 user.perms（细粒度）或 user.roles（角色名即权限码）
     */
    hasPerm(code?: string): boolean {
      if (!code) return true
      const u = this.user
      if (!u) return false
      if (u.roles?.some((r) => ADMIN_ROLES.includes(r))) return true
      return !!u.perms?.includes('*') || !!u.perms?.includes(code) || !!u.roles?.includes(code)
    }
  }
})
