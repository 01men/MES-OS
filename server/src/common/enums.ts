/**
 * 全局共享枚举。下游业务模块只允许引用，禁止修改。
 */

/** 单据状态（10 态）。迁移规则见 common/doc-status.machine.ts */
export enum DocStatus {
  DRAFT = 'DRAFT', // 草稿
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 待审批
  APPROVED = 'APPROVED', // 已审批
  PENDING_SYNC = 'PENDING_SYNC', // 待同步 U8
  SYNC_ERROR = 'SYNC_ERROR', // 同步失败
  SYNCED = 'SYNCED', // 已同步
  COMPLETED = 'COMPLETED', // 已完成
  VOID = 'VOID', // 已作废（终止态）
  REVERSED = 'REVERSED', // 已冲销（终止态）
}

/** 库存批次状态 */
export enum StockStatus {
  QUALIFIED = 'QUALIFIED', // 合格（计入可用量）
  PENDING_INSPECTION = 'PENDING_INSPECTION', // 待检
  ISOLATED = 'ISOLATED', // 不良/隔离
  SURPLUS_YL = 'SURPLUS_YL', // 余料
  STAGING = 'STAGING', // 备料区
  FROZEN = 'FROZEN', // 冻结/盘点锁定
  EXPIRED = 'EXPIRED', // 过期
}

/** 库存占用状态 */
export enum OccupationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CONSUMED = 'CONSUMED',
}

/** 库存流水类型 */
export enum MovementType {
  INBOUND = 'INBOUND',
  STATUS_CHANGE = 'STATUS_CHANGE',
  MOVE = 'MOVE',
  OCCUPY = 'OCCUPY',
  RELEASE = 'RELEASE',
  CONSUME = 'CONSUME',
  ADJUST = 'ADJUST',
}

/** 业务单据类型（编号器前缀即取此码） */
export enum BizType {
  RCV = 'RCV', // 收料
  PREP = 'PREP', // 备料
  SURPLUS = 'SUR', // 余料
  TRANSFER = 'TRF', // 调拨
  RETURN = 'RTN', // 退库
  STOCKTAKE = 'STK', // 盘点
  SHIPPING = 'SHP', // 发货
}

/** ABC 分类 */
export enum AbcClass {
  A = 'A',
  B = 'B',
  C = 'C',
  UNSET = 'UNSET',
}

/** 离线任务状态 */
export enum OfflineStatus {
  PENDING = 'PENDING', // 待同步
  SYNCING = 'SYNCING', // 同步中
  FAILED = 'FAILED', // 失败
  CONFLICT = 'CONFLICT', // 冲突
}

/** 审批单状态 */
export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** 权限类型 */
export enum PermissionType {
  MENU = 'menu',
  BUTTON = 'button',
}

/** 数据范围 */
export enum DataScope {
  ALL = 'ALL',
  DEPT = 'DEPT',
  SELF = 'SELF',
}

/** 余料区固定库区码 */
export const YL_AREA_CODE = 'YL';
