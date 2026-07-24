import http from './http'

export type StocktakeScopeType = 'ABC' | 'MATERIAL' | 'AREA'
export type StocktakeTaskStatus = 'OPEN' | 'COUNTING' | 'COMPLETED'
export type FreezeMode = 'NONE' | 'HARD' | 'SOFT'

export interface StocktakeStrategy {
  id: number
  name: string
  scopeType: StocktakeScopeType
  scopeValue: string
  cycleDays: number
  ownerUserId: string
  active: boolean
  createdAt: string
}

export interface StocktakeTask {
  id: number
  taskNo: string
  taskType: 'CYCLE' | 'ANNUAL'
  strategyId?: number
  generatedDate: string
  status: StocktakeTaskStatus
  blind: boolean
  freezeMode: FreezeMode
  freezeActive: boolean
  softApprovalId?: number
  adjustApprovalId?: number
  ownerUserId?: string
  createdAt: string
}

export interface StocktakeLine {
  lineNo: string
  packageNo: string
  materialCode: string
  batchNo: string
  warehouseCode: string
  locationCode: string
  /** 盲盘任务对非管理角色不返回 */
  bookQty?: number
  actualQty?: number
  recountQty?: number
  /** 盲盘任务对非管理角色不返回 */
  diff?: number | null
  needRecount: boolean
  reason?: string
  status: 'PENDING' | 'COUNTED' | 'RECOUNTED' | 'POSTED'
  countedBy?: string
  recountedBy?: string
}

export type StocktakeTaskDetail = StocktakeTask & { lines: StocktakeLine[] }

/** 软冻结解冻返回的逐笔对账清单行 */
export interface ReconcileLine {
  lineNo: string
  packageNo: string
  materialCode: string
  batchNo: string
  snapshotQty: number
  movementSum: number
  expectedQty: number
  currentQty: number
  match: boolean
}

export interface UnfreezeResult {
  taskNo: string
  mode: 'HARD' | 'SOFT'
  restored?: string[]
  reconciliation?: ReconcileLine[]
}

export interface ReportLine {
  lineNo: string
  packageNo: string
  materialCode: string
  batchNo: string
  locationCode: string
  areaCode: string
  abcClass: string
  bookQty: number
  snapshotQty: number
  frozenMovementSum: number
  actualQty: number | null
  diff: number | null
  diffRate: number | null
  reason?: string
  countedBy?: string
  recountedBy?: string
  postedQty?: number
  status: string
}

export interface StocktakeReport {
  taskNo: string
  taskType: string
  status: string
  blind: boolean
  freezeMode: FreezeMode
  ownerUserId?: string
  lines: ReportLine[]
  totals: {
    bookQty: number
    actualQty: number
    diff: number
    diffRate: number | null
    postedDiff: number
  }
  summary: {
    byArea: { key: string; book: number; actual: number; diff: number }[]
    byAbcClass: { key: string; book: number; actual: number; diff: number }[]
    byOwner: { key: string; book: number; actual: number; diff: number }[]
  }
  consistency: {
    reportDiff: number
    postedDiff: number
    consistent: boolean | null
  }
}

export interface AgingRow {
  packageNo: string
  materialCode: string
  materialName: string | null
  batchNo: string
  locationCode: string
  qty: number
  receivedAt: string
  lastMoveDate: string
  ageDays: number
  daysSinceMove: number
  reinspectDays: number
  level: 'NONE' | 'WARN_3M' | 'REINSPECT_DUE'
}

export function listStrategies() {
  return http.get<StocktakeStrategy[]>('/stocktake/strategies')
}

export function createStrategy(data: {
  name: string
  scopeType: StocktakeScopeType
  scopeValue: string
  cycleDays: number
  ownerUserId: string
}) {
  return http.post('/stocktake/strategies', data)
}

export function generateTasks() {
  return http.post('/stocktake/tasks/generate')
}

export function listTasks(status?: string) {
  return http.get<StocktakeTask[]>('/stocktake/tasks', {
    params: status ? { status } : {}
  })
}

export function getTask(id: number) {
  return http.get<StocktakeTaskDetail>(`/stocktake/tasks/${id}`)
}

/** HARD 返回 { taskNo, mode, status, frozen }；SOFT 返回审批单对象（含 id，待审批） */
export function freezeTask(id: number, mode: 'HARD' | 'SOFT') {
  return http.post<{ id?: number; taskNo?: string; mode?: string; frozen?: number }>(
    `/stocktake/${id}/freeze`,
    { mode }
  )
}

export function unfreezeTask(id: number) {
  return http.post<UnfreezeResult>(`/stocktake/${id}/unfreeze`)
}

export function postAdjustments(id: number) {
  return http.post(`/stocktake/${id}/post-adjustments`)
}

export function getReport(id: number) {
  return http.get<StocktakeReport>(`/stocktake/${id}/report`)
}

export function getAging() {
  return http.get<AgingRow[]>('/stocktake/aging')
}
