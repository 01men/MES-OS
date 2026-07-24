import http from '@/api/http'

/** 齐套物料行 */
export interface KittingLine {
  materialCode: string
  unit: string
  requiredQty: number
  qualifiedQty: number
  occupiedQty: number
  safetyStock: number
  available: number
  shortageQty: number
  status: 'OK' | 'SHORTAGE'
  /** 三区域库存可视（仅合格品计入可用） */
  visibility: {
    qualified: number
    pendingInspection: number
    staging: number
  }
}

export interface ShortageLine {
  materialCode: string
  requiredQty: number
  available: number
  shortageQty: number
}

/** 单工单齐套结果（/prep/kitting?workOrderId=） */
export interface KittingResult {
  workOrderId: string
  productCode: string
  planQty: number
  bomCode: string
  kitting: boolean
  status: 'KIT' | 'SHORTAGE'
  shortageLines: ShortageLine[]
  lines: KittingLine[]
  computedAt: string
}

/** 看板行：正常行为齐套结果 + 工单信息；无 BOM 工单为降级行 */
export interface KittingBoardRow extends Partial<Omit<KittingResult, 'status'>> {
  workOrderId: string
  productCode: string
  planQty: number
  workOrderStatus: string
  planDate: string
  status: 'KIT' | 'SHORTAGE' | 'NO_BOM'
  kitting: boolean
  error?: string
}

/** 齐套看板：全部工单 + 齐套状态 + 缺料明细 */
export async function getKittingBoard(): Promise<KittingBoardRow[]> {
  const res = await http.get('/prep/kitting/board')
  return res.data
}

/** 单工单齐套检查（实时计算） */
export async function getKitting(workOrderId: string): Promise<KittingResult> {
  const res = await http.get('/prep/kitting', { params: { workOrderId } })
  return res.data
}
