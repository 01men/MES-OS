import http from '@/api/http'

/** 缺链路段标注（后端约定文案） */
export const THEORETICAL_BOM = '理论 BOM 追溯'

export interface TraceMaterial {
  packageNo: string
  materialCode: string
  workOrderId: string | null
  sourceDocNo: string
  receivedAt: string
}

export interface TraceWorkOrder {
  workOrderId: string
  productCode: string | null
  status: string | null
  source?: string
}

export interface TraceSerial {
  serialNo: string
  productCode: string
  status: string
}

export interface TraceShipment {
  dnNo: string
  status: string
  customerCode: string
  customerName: string | null
  releasedAt: string | null
  /** 关联发货照片（后端后续补充，前端防御性展示） */
  photos?: { url: string; photoType?: string }[]
}

/** 正向追溯：原料批次 → 工单 → 序列号 → 发货单 → 客户 */
export interface ForwardTrace {
  direction: 'forward'
  batchNo: string
  materials: TraceMaterial[]
  workOrders: TraceWorkOrder[]
  serials: TraceSerial[]
  shipments: TraceShipment[]
  customer: { customerCode: string; customerName: string | null } | null
}

export interface TraceBatch {
  batchNo: string | null
  materialCode: string
  packageNo: string | null
  receivedAt: string | null
  source: string
  supplierCode: string | null
  supplierName: string | null
}

/** 反向追溯：序列号 → 工单 → 批次 → 供应商 → 来料日期 */
export interface BackwardTrace {
  direction: 'backward'
  serialNo: string
  productCode: string
  status: string
  workOrder: TraceWorkOrder | null
  batches: TraceBatch[]
  shipment: {
    dnNo: string
    customerCode: string
    customerName: string | null
    photos?: { url: string; photoType?: string }[]
  } | null
}

export async function traceForward(batchNo: string): Promise<ForwardTrace> {
  const res = await http.get('/shipping/trace/forward', { params: { batchNo } })
  return res.data
}

export async function traceBackward(serialNo: string): Promise<BackwardTrace> {
  const res = await http.get('/shipping/trace/backward', { params: { serialNo } })
  return res.data
}

/** 追溯报告导出（后端返回 CSV 文本，前端 Blob 下载） */
export async function exportTrace(params: { batchNo?: string; serialNo?: string }): Promise<string> {
  const res = await http.get('/shipping/trace/export', { params, responseType: 'text' })
  return res.data
}
