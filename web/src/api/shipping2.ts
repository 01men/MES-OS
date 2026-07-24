import http from '@/api/http'

/** 发货单状态（统一状态机） */
export type DocStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PENDING_SYNC'
  | 'SYNC_ERROR'
  | 'SYNCED'
  | 'COMPLETED'
  | 'VOID'
  | 'REVERSED'

export interface NoteLine {
  id: number
  orderNo: string
  productCode: string
  qty: number
  unit: string
  scannedQty: number
  shortageQty: number
}

export interface Shortage {
  id: number
  noteId: number
  orderNo: string
  productCode: string
  qty: number
  reason: string
  approvalId: number | null
  /** PENDING_APPROVAL | APPROVED | REJECTED */
  status: string
  /** OPEN 待补发 | RESHIPPED 已补发 */
  reshipStatus: string
  createdAt: string
}

/** 发货单摘要（列表与详情共用结构） */
export interface NoteSummary {
  id: number
  dnNo: string
  customerCode: string
  customerName: string | null
  source: 'U8' | 'SALES'
  status: DocStatus
  loadingSequence: string[] | null
  expectedQty: number
  scannedQty: number
  shortageQty: number
  duplicateScanCount: number
  keeperConfirmBy: string | null
  driverName: string | null
  releasedAt: string | null
  nextExpected: { orderNo: string; productCode: string; remaining: number } | null
  lines: NoteLine[]
  shortages: Shortage[]
}

export interface PullNotesResult {
  pulled: number
  created: string[]
  skipped: string[]
}

export interface CreateNoteLineInput {
  orderNo?: string
  productCode: string
  qty: number
}

export interface CreateNoteInput {
  customerCode: string
  lines: CreateNoteLineInput[]
  /** 装柜顺序：订单号数组 */
  loadingSequence?: string[]
}

/** 从 U8 增量拉取发货通知（幂等） */
export async function pullNotes(since?: string): Promise<PullNotesResult> {
  const res = await http.post('/shipping/pull-notes', since ? { since } : {})
  return res.data
}

/** 销售在系统内创建发货单 */
export async function createNote(data: CreateNoteInput): Promise<NoteSummary> {
  const res = await http.post('/shipping/notes', data)
  return res.data
}

/** 发货单列表（可按状态过滤，按 id 倒序） */
export async function listNotes(status?: DocStatus): Promise<NoteSummary[]> {
  const res = await http.get('/shipping/notes', { params: status ? { status } : {} })
  return res.data
}

/** 发货单详情（含应发/已扫/欠发/lines/shortages/nextExpected） */
export async function getNote(id: number): Promise<NoteSummary> {
  const res = await http.get(`/shipping/notes/${id}`)
  return res.data
}
