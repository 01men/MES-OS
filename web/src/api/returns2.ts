import http from './http'

/** 损耗原因（与 server WriteoffReason 枚举一致） */
export type WriteoffReason = 'CUSTOMER_INSPECT' | 'DESTRUCTIVE_TEST' | 'OTHER'
/** 核销单状态：双审批中 / 已过账 / 已作废 */
export type WriteoffStatus = 'PENDING_APPROVAL' | 'POSTED' | 'VOID'

export interface WriteoffOrder {
  id: number
  docNo: string
  workOrderId?: string
  materialCode: string
  batchNo: string
  packageNo: string
  qty: number
  reason: WriteoffReason
  customerOrderNo?: string
  approvalId?: number
  status: WriteoffStatus
  u8Synced: boolean
  operator: string
  createdAt: string
  postedAt?: string
}

export interface WriteoffCreateBody {
  workOrderId?: string
  materialCode: string
  batchNo: string
  packageNo: string
  qty: number
  reason: WriteoffReason
  /** 客检（CUSTOMER_INSPECT）必填 */
  customerOrderNo?: string
}

export function listWriteoffs() {
  return http.get<WriteoffOrder[]>('/returns/writeoffs')
}

export function createWriteoff(data: WriteoffCreateBody) {
  return http.post('/returns/writeoffs', data)
}

/** 双审批通过后过账（扣减库存 + 同步 U8） */
export function postWriteoff(id: number) {
  return http.post(`/returns/writeoffs/${id}/post`)
}

/** 导出 CSV（返回 Blob） */
export function exportWriteoffs() {
  return http.get('/returns/writeoffs/export', { responseType: 'blob' })
}
