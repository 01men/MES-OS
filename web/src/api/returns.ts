import http from './http'

/** P08 退补料 / P12 良品不良品调拨 API（baseURL 已含 /api） */

export type ReturnType = 'DEFECT' | 'OVER_ISSUE' | 'NORMAL'
export type ReplenishType = 'TRANSFER_ONLY' | 'RETURN_AND_REPLENISH' | 'DIRECT'

export interface ReturnPayload {
  workOrderId: string
  type: ReturnType
  materialCode: string
  batchNo: string
  qty: number
  reason?: string
  defectRecordId?: string
}

/** 退料（不良/超领/正常）；超限时后端返回阈值错误 */
export function createReturn(data: ReturnPayload) {
  return http.post('/returns', data, { silent: true } as never)
}

export interface ReplenishPayload {
  workOrderId: string
  type: ReplenishType
  materialCode: string
  qty: number
  returnOrderId?: string
}

/** 补料（余量调拨/一退一补/直接补料） */
export function createReplenish(data: ReplenishPayload) {
  return http.post('/returns/replenish', data, { silent: true } as never)
}

export interface QtransferPayload {
  packageNo: string
  direction: 'GOOD_TO_BAD' | 'BAD_TO_GOOD'
  reason: string
}

/** P12 良品↔不良品调拨申请 */
export function createQtransfer(data: QtransferPayload) {
  return http.post('/returns/qtransfers', data, { silent: true } as never)
}

/** P12 质检电子签确认（质检角色账号操作） */
export function confirmQtransfer(id: string) {
  return http.post(`/returns/qtransfers/${id}/confirm`, {}, { silent: true } as never)
}
