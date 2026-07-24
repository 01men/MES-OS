import http from '@/api/http'

/** 到货暂存单状态：ARRIVED → INSPECTING → INSPECTED → CONFIRMED */
export type ArrivalStatus = 'ARRIVED' | 'INSPECTING' | 'INSPECTED' | 'CONFIRMED'

/** IQC 判定方式 */
export type IqcDecision = 'ALL' | 'PARTIAL' | 'CONCESSION'

export interface ArrivalRow {
  id: number
  arrivalNo: string
  poNo: string
  materialCode: string
  qty: number
  scannedQty: number
  orderQty: number
  supplierCode: string
  batchNo: string
  packageNo: string
  warehouseCode: string
  locationCode: string
  abcClass: string
  countMode: string
  status: ArrivalStatus
  iqcDecision: IqcDecision | null
  qualifiedQty: number | null
  rejectedQty: number | null
  concessionQty: number | null
  pendingQty: number | null
  defectDescription: string | null
  approvalId: number | null
  isOutsource: boolean
  workOrderId: string | null
  printCount: number
  syncStatus: string | null
  createdAt: string
  updatedAt: string
}

export interface InboundPosting {
  packageNo: string
  qty: number
  status: 'QUALIFIED' | 'ISOLATED'
  concession: boolean
  isOutsource: boolean
  sourcePoNo: string
  supplierCode: string
}

export interface NcrReport {
  id: number
  ncrNo: string
  arrivalNo: string
  batchNo: string
  materialCode: string
  qty: number
  defectDescription: string
  notifyRoles: string
  status: string
  createdAt: string
}

export interface LabelLog {
  id: number
  packageNo: string
  arrivalNo: string
  printType: string
  reason: string | null
  printSeq: number
  printedBy: string
  createdAt: string
}

export interface ArrivalDetail extends ArrivalRow {
  postings: InboundPosting[]
  labelLogs: LabelLog[]
  ncrReports: NcrReport[]
}

export interface IqcInput {
  decision: IqcDecision
  qualifiedQty: number
  rejectedQty: number
  concessionQty: number
  pendingQty: number
  defectDescription?: string
}

export interface IqcResult extends ArrivalRow {
  ncrReport: NcrReport | null
}

/** 待检到货单列表（默认 INSPECTING） */
export async function listArrivals(status?: ArrivalStatus): Promise<ArrivalRow[]> {
  const res = await http.get('/receiving/arrivals', { params: status ? { status } : {} })
  return res.data
}

/** 到货单详情（含 IQC 四分量 / postings / ncrReports / labelLogs） */
export async function getArrival(id: number): Promise<ArrivalDetail> {
  const res = await http.get(`/receiving/${id}`)
  return res.data
}

/** 提交 IQC 判定；特采返回 approvalId（MRB 会签审批单） */
export async function submitIqc(id: number, data: IqcInput): Promise<IqcResult> {
  const res = await http.post(`/receiving/${id}/iqc`, data)
  return res.data
}

/** 确认入库/隔离（已判定单）；manualReview 用于标签计数超容差人工复核 */
export async function confirmArrival(id: number, data?: { manualReview?: boolean }): Promise<unknown> {
  const res = await http.post(`/receiving/${id}/confirm`, data ?? {})
  return res.data
}
