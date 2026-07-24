import http from './http'

/** P01 收料扫码 —— 后端契约（baseURL 已含 /api） */

/** 条码解析结果（条码格式 PO|料号|数量|供应商|批次时间） */
export interface ReceivingScanResult {
  poNo: string
  materialCode: string
  materialName?: string
  unit: string
  /** 剩余可收数量 */
  remainingQty: number
  /** ABC 分类：A 全点 / B 抽查 / C 按标签计数 */
  abcClass: string
  countMode: 'FULL' | 'SAMPLE' | 'LABEL'
  countHint: string
}

export interface ArrivalPayload {
  poNo: string
  materialCode: string
  /** 实收数量 */
  qty: number
  scannedQty: number
  labelQty: number
  warehouseCode: string
  locationCode: string
  workOrderId?: string
  overApprovalId?: string
}

export interface ArrivalLabel {
  packageNo?: string
  materialCode?: string
  qty?: number
  batchNo?: string
  [key: string]: unknown
}

export interface ArrivalResult {
  arrivalNo: string
  packageNo: string
  batchNo: string
  label: ArrivalLabel | string
}

export interface IqcPayload {
  decision: 'ALL' | 'PARTIAL' | 'CONCESSION'
  qualifiedQty: number
  rejectedQty: number
  concessionQty: number
  pendingQty: number
  defectDescription: string
}

export interface IqcResult {
  /** 特采时返回 MRB 会签审批单号 */
  approvalId?: string
  [key: string]: unknown
}

export interface ConfirmResult {
  postings: unknown
  syncStatus: string
  workOrderIssueReminder?: string
}

export interface ArrivalItem {
  id: string | number
  arrivalNo?: string
  poNo?: string
  materialCode?: string
  qty?: number
  status?: string
  packageNo?: string
  batchNo?: string
  [key: string]: unknown
}

export function scanBarcode(barcode: string) {
  return http.post<ReceivingScanResult>('/receiving/scan', { barcode }, { silent: true } as never)
}

export function syncOrders() {
  return http.post('/receiving/orders/sync')
}

export function getOrders() {
  return http.get('/receiving/orders')
}

export function createArrival(data: ArrivalPayload) {
  return http.post<ArrivalResult>('/receiving/arrivals', data, { silent: true } as never)
}

export function sendInspect(id: string | number) {
  return http.post(`/receiving/${id}/send-inspect`, {}, { silent: true } as never)
}

export function submitIqc(id: string | number, data: IqcPayload) {
  return http.post<IqcResult>(`/receiving/${id}/iqc`, data, { silent: true } as never)
}

export function confirmArrival(id: string | number, manualReview?: boolean) {
  return http.post<ConfirmResult>(
    `/receiving/${id}/confirm`,
    { manualReview },
    { silent: true } as never
  )
}

export function getArrivals(status?: string) {
  return http.get<ArrivalItem[]>('/receiving/arrivals', { params: status ? { status } : {} })
}

export function getArrival(id: string | number) {
  return http.get<ArrivalItem>(`/receiving/${id}`)
}

export function reprintLabel(packageNo: string, reason: string) {
  return http.post('/receiving/labels/reprint', { packageNo, reason }, { silent: true } as never)
}
