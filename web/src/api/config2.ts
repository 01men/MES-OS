import http from './http'

/**
 * 规则配置 API（版本化：新值追加为新版本，不覆盖旧版）。
 * 实际后端路径（server/src/modules/config/rule-config.controller.ts）：
 *   GET  /config/rules/:key          当前生效值（纯字符串）
 *   GET  /config/rules/:key/history  版本历史
 *   POST /config/rules               { key, value } 创建新版本
 * 后端暂无“列出全部 key”端点，前端按已知 key 清单逐个拉取。
 */
export interface RuleVersion {
  id: number
  key: string
  value: string
  version: number
  effectiveAt: string
  operator?: string
  createdAt: string
}

/** 取当前生效值（不存在时后端返回空） */
export function getRule(key: string) {
  return http.get<string>(`/config/rules/${encodeURIComponent(key)}`, {
    silent: true
  } as never)
}

/** 版本历史（按 version 倒序） */
export function getRuleHistory(key: string) {
  return http.get<RuleVersion[]>(`/config/rules/${encodeURIComponent(key)}/history`)
}

/** 创建新版本 */
export function setRule(key: string, value: string) {
  return http.post<RuleVersion>('/config/rules', { key, value })
}
