import http from './http'

export interface AuthConfig {
  dingtalkEnabled: boolean
  dingtalkClientId?: string
}

export interface DingTalkAdminConfig {
  enabled: boolean
  ready: boolean
  clientId: string
  hasSecret: boolean
  publicOrigin: string
  callbackUrl: string
  source: 'database' | 'environment'
}

export function getAuthConfig() {
  return http.get<AuthConfig>('/auth/config', { silent: true } as never)
}

export function getDingTalkLoginUrl() {
  return http.get<{ url: string; expiresAt: string }>('/auth/dingtalk/login-url')
}

export function getDingTalkBindUrl() {
  return http.get<{ url: string; expiresAt: string }>('/auth/dingtalk/bind-url')
}

export function unbindOwnDingTalk() {
  return http.post<{ dingtalkBound: false }>('/auth/dingtalk/unbind')
}

export function getDingTalkAdminConfig() {
  return http.get<DingTalkAdminConfig>('/auth/dingtalk/config')
}

export function saveDingTalkAdminConfig(body: {
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  clearSecret?: boolean
  publicOrigin?: string
}) {
  return http.put<DingTalkAdminConfig>('/auth/dingtalk/config', body)
}
