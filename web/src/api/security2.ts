import http from './http'

/**
 * 权限（RBAC）与审计日志 API。
 * 与后端 /api/rbac/*、/api/audit/* REST 契约保持一致。
 */
export interface RbacUser {
  id: number
  username: string
  name?: string
  roles?: string[] | { id: number; code?: string; name: string }[]
  dingtalkBound?: boolean
  warehouseCodes?: string[]
  [k: string]: unknown
}

export interface RbacRole {
  id: number
  code?: string
  name: string
  permissions?: string[] | { id: number; code?: string; name: string }[]
  [k: string]: unknown
}

export interface RbacPermission {
  id: number
  code: string
  name?: string
  type?: 'menu' | 'button'
  [k: string]: unknown
}

export interface TempGrant {
  id: number
  username?: string
  userId?: number
  permissionCode?: string
  permCode?: string
  permission?: string
  expiresAt?: string
  expireAt?: string
  [k: string]: unknown
}

export interface WarehouseOption {
  warehouseCode: string
  name?: string
}

export interface AuditLog {
  id: number
  operator: string
  role?: string
  device?: string
  ip?: string
  action: string
  docNo?: string
  /** 变更前快照 JSON 字符串 */
  before?: string
  /** 变更后快照 JSON 字符串 */
  after?: string
  result: string
  createdAt: string
}

export interface AuditQuery {
  operator?: string
  action?: string
  docNo?: string
  from?: string
  to?: string
}

export interface AuditPage {
  total: number
  page: number
  size: number
  items: AuditLog[]
}

export function listUsers() {
  return http.get<RbacUser[]>('/rbac/users')
}

export function listRoles() {
  return http.get<RbacRole[]>('/rbac/roles')
}

export function listPermissions() {
  return http.get<RbacPermission[]>('/rbac/permissions')
}

/** 临时授权列表（如后端提供） */
export function listTempGrants() {
  return http.get<TempGrant[]>('/rbac/temp-grants', { silent: true } as never)
}

export function assignUserRoles(userId: number, roles: (number | string)[]) {
  return http.post(`/rbac/users/${userId}/roles`, { roles })
}

export function assignUserWarehouses(userId: number, warehouseCodes: string[]) {
  return http.post(`/rbac/users/${userId}/warehouses`, { warehouseCodes })
}

export function listWarehouses() {
  return http.get<WarehouseOption[]>('/masterdata/warehouses')
}

export function createTempGrant(body: {
  userId: number
  permissionCode: string
  expiresAt: string
}) {
  return http.post<TempGrant>('/rbac/temp-grants', body)
}

export function revokeTempGrant(grantId: number) {
  return http.delete(`/rbac/temp-grants/${grantId}`)
}

export function unbindUserDingTalk(userId: number) {
  return http.post(`/rbac/users/${userId}/dingtalk/unbind`)
}

export function listAuditLogs(params: AuditQuery) {
  return http.get<AuditPage>('/audit/logs', { params })
}

/** 导出审计日志 CSV（返回 Blob） */
export function exportAuditLogs(params: AuditQuery) {
  return http.get('/audit/logs/export', { params, responseType: 'blob' })
}
