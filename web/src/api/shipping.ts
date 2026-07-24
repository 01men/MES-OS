import http from './http'

/** P14 成品出库放行 API（baseURL 已含 /api） */

/** 六类装柜照片 */
export type PhotoType = 'CAR' | 'SEAL' | 'EMPTY' | 'SIDE1' | 'SIDE2' | 'MARK'

export interface ShippingLine {
  orderNo?: string
  productCode?: string
  productName?: string
  shouldQty?: number
  scannedQty?: number
  shortageQty?: number
}

export interface ShippingNote {
  id: string
  noteNo: string
  customerCode?: string
  status: string
  shouldQty?: number
  scannedQty?: number
  shortageQty?: number
  duplicateScanCount?: number
  /** 下一应扫提示 { orderNo, productCode } */
  nextExpected?: { orderNo?: string; productCode?: string } | null
  lines?: ShippingLine[]
  shortages?: Array<{ orderNo?: string; productCode?: string; qty?: number }>
  u8SyncStatus?: string
}

export function fetchNotes(status?: string) {
  return http.get('/shipping/notes', { params: status ? { status } : {} })
}

export function fetchNote(id: string) {
  return http.get(`/shipping/notes/${id}`)
}

/**
 * 序列号扫码。错误码（err.response.data.code）：
 * SERIAL_NOT_FOUND / DUPLICATE_SCAN / WRONG_ORDER / OVER_SHIP / SEQUENCE_VIOLATION
 */
export function scanSerial(id: string, serialNo: string) {
  return http.post(`/shipping/notes/${id}/scan`, { serialNo }, { silent: true } as never)
}

export function confirmPhotos(id: string, photos: Array<{ photoType: PhotoType; url: string }>) {
  return http.post(`/shipping/notes/${id}/photos/confirm`, { photos }, { silent: true } as never)
}

export function shortShip(id: string, reason: string) {
  return http.post(`/shipping/notes/${id}/short-ship`, { reason }, { silent: true } as never)
}

/** 放行（必须在线）：仓管员确认 + 司机确认 */
export function release(id: string, data: { keeperConfirm: true; driverName: string; driverConfirm: true }) {
  return http.post(`/shipping/notes/${id}/release`, data, { silent: true } as never)
}
