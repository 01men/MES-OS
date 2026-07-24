import http from './http'

/** P04 备料作业 / P05 物权交接 —— 后端契约（baseURL 已含 /api） */

export interface KittingVisibility {
  qualified: number
  pendingInspection: number
  staging: number
}

export interface KittingLine {
  materialCode?: string
  materialName?: string
  requiredQty: number
  available: number
  shortageQty: number
  /** 推荐储位（若后端下发） */
  locationCode?: string
  recommendedLocation?: string
  visibility: KittingVisibility
  [key: string]: unknown
}

export interface KittingResult {
  kitting: boolean
  status: string
  shortageLines: KittingLine[]
  lines: KittingLine[]
}

export interface BoardItem {
  workOrderId: string
  kitting?: boolean
  status?: string
  shortageLines?: KittingLine[]
  [key: string]: unknown
}

export interface PrepTaskLine {
  materialCode?: string
  materialName?: string
  packageNo?: string
  locationCode?: string
  recommendedLocation?: string
  requiredQty: number
  scannedQty?: number
  [key: string]: unknown
}

export interface PrepTask {
  id: string | number
  prepDocNo?: string
  workOrderId?: string
  status?: string
  lines?: PrepTaskLine[]
  [key: string]: unknown
}

export interface ScanResult {
  duplicated?: boolean
  scannedQty?: number
  firstScanTime?: string
  firstScanUser?: string
  [key: string]: unknown
}

export interface PrepOrder {
  id: string | number
  prepId?: string | number
  prepDocNo?: string
  workOrderId?: string
  status?: string
  lines?: PrepTaskLine[]
  keeperConfirmed?: boolean
  receiverConfirmed?: boolean
  keeperConfirmTime?: string
  receiverConfirmTime?: string
  postingStatus?: string
  u8SyncStatus?: string
  leftoverReminder?: string
  handover?: {
    keeperConfirmed?: boolean
    receiverConfirmed?: boolean
    postingStatus?: string
    u8SyncStatus?: string
  }
  [key: string]: unknown
}

export function getKitting(workOrderId: string) {
  return http.get<KittingResult>('/prep/kitting', { params: { workOrderId } })
}

export function getKittingBoard() {
  return http.get<BoardItem[]>('/prep/kitting/board')
}

export function createPrepTask(workOrderId: string, emergencyReason?: string) {
  return http.post<PrepTask>(
    '/prep/tasks',
    { workOrderId, emergencyReason },
    { silent: true } as never
  )
}

export function getPrepTask(id: string | number) {
  return http.get<PrepTask>(`/prep/tasks/${id}`)
}

export function scanPackage(id: string | number, data: { packageNo: string; qty?: number; device?: string }) {
  return http.post<ScanResult>(`/prep/tasks/${id}/scan`, data, { silent: true } as never)
}

export function suspendTask(id: string | number) {
  return http.post(`/prep/tasks/${id}/suspend`, {}, { silent: true } as never)
}

export function completeTask(id: string | number) {
  return http.post<PrepTask>(`/prep/tasks/${id}/complete`, {}, { silent: true } as never)
}

export function confirmHandover(
  prepId: string | number,
  role: 'KEEPER' | 'RECEIVER',
  device?: string
) {
  return http.post(`/prep/${prepId}/handover/confirm`, { role, device }, { silent: true } as never)
}

export function rejectHandover(prepId: string | number, reason?: string) {
  return http.post(`/prep/${prepId}/handover/reject`, { reason }, { silent: true } as never)
}

export function getPrepOrders() {
  return http.get<PrepOrder[]>('/prep/orders')
}

export function getPrepOrder(prepDocNo: string) {
  return http.get<PrepOrder>(`/prep/orders/${encodeURIComponent(prepDocNo)}`, {
    silent: true
  } as never)
}
