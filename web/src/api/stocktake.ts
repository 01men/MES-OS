import http from './http'

/** P10 盘点 API（baseURL 已含 /api） */
export interface StocktakeLine {
  lineNo: string
  locationCode: string
  materialCode: string
  batchNo?: string
  /** 盲盘时后端不返回 */
  bookQty?: number
  actualQty?: number
  needRecount: boolean
  status: string
}

export interface StocktakeTask {
  id: string
  taskNo: string
  blind: boolean
  status?: string
  lines?: StocktakeLine[]
}

export function fetchTasks(status?: string) {
  return http.get('/stocktake/tasks', { params: status ? { status } : {} })
}

export function fetchTask(id: string) {
  return http.get(`/stocktake/tasks/${id}`)
}

/** 初盘录入（返回 { needRecount }）；超阈值时后端标记需复盘 */
export function submitCount(id: string, data: { lineNo: string; actualQty: number; reason?: string }) {
  return http.post(`/stocktake/tasks/${id}/count`, data, { silent: true } as never)
}

/** 复盘录入（须第二人操作，超阈值必填原因） */
export function submitRecount(id: string, data: { lineNo: string; actualQty: number; reason: string }) {
  return http.post(`/stocktake/tasks/${id}/recount`, data, { silent: true } as never)
}
