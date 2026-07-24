import http from '@/api/http'

/** 库存批次状态 */
export type StockStatus =
  | 'QUALIFIED'
  | 'PENDING_INSPECTION'
  | 'ISOLATED'
  | 'SURPLUS_YL'
  | 'STAGING'
  | 'FROZEN'
  | 'EXPIRED'

/** 库存批次行（最小包装维度） */
export interface StockLot {
  id: number
  packageNo: string
  materialCode: string
  batchNo: string
  warehouseCode: string
  locationCode: string
  qty: number
  status: StockStatus
  workOrderId: string | null
  sourceDocNo: string
  receivedAt: string
  expiryDate: string | null
  createdAt: string
}

/** 可用量口径：合格现存 − 有效占用 − 安全库存 = 可用 */
export interface AvailableResult {
  materialCode: string
  qualifiedQty: number
  occupiedQty: number
  safetyStock: number
  available: number
}

export interface LotFilter {
  materialCode?: string
  batchNo?: string
  warehouseCode?: string
  status?: StockStatus
}

/** 库存批次台账查询 */
export async function queryLots(filter: LotFilter): Promise<StockLot[]> {
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(filter)) {
    if (v) params[k] = v
  }
  const res = await http.get('/inventory/lots', { params })
  return res.data
}

/** 物料可用量（合格现存 − 有效占用 − 安全库存） */
export async function getAvailable(materialCode: string): Promise<AvailableResult> {
  const res = await http.get(`/inventory/available/${encodeURIComponent(materialCode)}`)
  return res.data
}
