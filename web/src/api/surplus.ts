import http from './http'

/** P06 余料登记 —— 后端契约（baseURL 已含 /api） */

export type SurplusSourceType = 'SUPPLIER_EXTRA' | 'ORDER_LEFT' | 'WORKSHOP_RETURN'
export type SurplusProcessMethod = 'RETURN_SUPPLIER' | 'REUSE_ORDER' | 'CROSS_TRANSFER'

export interface SurplusPayload {
  packageNo: string
  sourceType: SurplusSourceType
  sourceDocNo: string
  responsible: string
}

export interface SurplusItem {
  id: string | number
  packageNo?: string
  sourceType?: SurplusSourceType
  sourceDocNo?: string
  responsible?: string
  status?: string
  qty?: number
  materialCode?: string
  zoneCode?: string
  [key: string]: unknown
}

export interface SurplusLabel {
  packageNo?: string
  materialCode?: string
  qty?: number
  sourceType?: string
  sourceDocNo?: string
  responsible?: string
  zoneCode?: string
  createdAt?: string
  [key: string]: unknown
}

export function createSurplus(data: SurplusPayload) {
  return http.post<SurplusItem>('/surplus', data, { silent: true } as never)
}

export function createFromLeftover(data: Record<string, unknown>) {
  return http.post('/surplus/from-leftover', data, { silent: true } as never)
}

export function getSurplusList() {
  return http.get<SurplusItem[]>('/surplus')
}

export function getSurplus(id: string | number) {
  return http.get<SurplusItem>(`/surplus/${id}`)
}

export function printSurplusLabel(id: string | number) {
  return http.post<SurplusLabel>(`/surplus/${id}/print`, {}, { silent: true } as never)
}

export function processSurplus(
  id: string | number,
  data: { method: SurplusProcessMethod; qty: number; targetWorkOrderId?: string }
) {
  return http.post(`/surplus/${id}/process`, data, { silent: true } as never)
}
