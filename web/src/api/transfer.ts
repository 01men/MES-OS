import http from './http'

/** P07 挪料 API（baseURL 已含 /api） */
export interface TransferPayload {
  sourceWorkOrderId: string
  targetWorkOrderId: string
  materialCode: string
  batchNo?: string
  qty: number
}

/** 挪料提交；专用件自动发起审批，响应含 approvalId */
export function createTransfer(data: TransferPayload) {
  return http.post('/transfer', data, { silent: true } as never)
}

export function fetchTodos() {
  return http.get('/transfer/todos')
}

/** 补料待办：确认补回 */
export function confirmReplenish(todoId: string) {
  return http.post(`/transfer/replenish/${todoId}/confirm`, {}, { silent: true } as never)
}
