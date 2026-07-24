import http from './http'

export interface AuthConfig {
  dingtalkEnabled: boolean
  dingtalkClientId?: string
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
