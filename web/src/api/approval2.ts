import http from './http'

/**
 * 审批中心 API。
 * 注意：后端审批 HTTP 控制器并行开发中（当前 server 仅有 ApprovalEngineService，
 * 无 /approval/* REST 端点）。以下路径按前后端约定契约编写，联调时以 server 端实际控制器为准。
 */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

export interface ApprovalStep {
  seq?: number
  approverRole?: string
  userId?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  actedBy?: string
  actedAt?: string
  comment?: string
}

export interface ApprovalOrder {
  id: number
  bizType: string
  bizId: string
  applicantId: string
  applicantName?: string
  status: ApprovalStatus
  /** 后端实体为 JSON 字符串，契约层可能已解析为数组，两种都兼容 */
  steps: ApprovalStep[] | string
  currentStep?: number
  rejectReason?: string
  createdAt: string
  updatedAt?: string
}

/** 待我审批 */
export function listTodo() {
  return http.get<ApprovalOrder[]>('/approval/todo')
}

/** 我已审批 */
export function listDone() {
  return http.get<ApprovalOrder[]>('/approval/done')
}

/** 我发起的 */
export function listMine() {
  return http.get<ApprovalOrder[]>('/approval/mine')
}

/** 全部（管理员） */
export function listAll() {
  return http.get<ApprovalOrder[]>('/approval/all')
}

export function approve(id: number, comment?: string) {
  return http.post(`/approval/${id}/approve`, { comment })
}

export function reject(id: number, reason: string) {
  return http.post(`/approval/${id}/reject`, { reason })
}

/** 兼容 steps 为 JSON 字符串或数组两种形态 */
export function parseSteps(steps: ApprovalOrder['steps']): ApprovalStep[] {
  if (Array.isArray(steps)) return steps
  try {
    const arr = JSON.parse(steps || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
