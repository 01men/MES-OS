import http from './http'

/** U8 同步任务（与 server SyncTask 实体一致；重试次数字段为 attempts） */
export interface SyncTask {
  id: number
  bizType: string
  bizKey: string
  voucherType: string
  payload: string
  status: 'PENDING_SYNC' | 'SYNCED' | 'SYNC_ERROR'
  attempts: number
  lastError?: string
  alarm?: string
  createdAt: string
  updatedAt?: string
}

export interface ReconcileResult {
  mesSyncedCount: number
  u8VoucherCount: number
  /** MES 已同步、U8 无对应凭证的 bizKey 列表 */
  inMesNotU8: string[]
  /** U8 有凭证、MES 未同步的 bizKey 列表 */
  inU8NotMes: string[]
}

export function listSyncLogs() {
  return http.get<SyncTask[]>('/integration/logs')
}

/** 人工重放（幂等） */
export function replaySync(id: number) {
  return http.post(`/integration/replay/${id}`)
}

/** 日终对账：MES 已同步 vs U8 凭证差异清单 */
export function reconcile() {
  return http.post<ReconcileResult>('/integration/reconcile')
}
