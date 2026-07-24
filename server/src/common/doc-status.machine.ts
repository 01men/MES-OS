import { DocStatus } from './enums';
import { BizException } from './exceptions';

/**
 * 统一单据状态机。
 * 主链路：DRAFT → PENDING_APPROVAL → APPROVED → PENDING_SYNC → SYNCED
 * 异常分支：PENDING_SYNC → SYNC_ERROR → PENDING_SYNC（重试/重放）
 * 终止态：VOID / REVERSED / COMPLETED
 * 硬约束：已 SYNCED 的单据只允许 REVERSED（禁止回编辑）。
 */
const TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  [DocStatus.DRAFT]: [DocStatus.PENDING_APPROVAL, DocStatus.VOID],
  [DocStatus.PENDING_APPROVAL]: [
    DocStatus.APPROVED,
    DocStatus.DRAFT, // 驳回置回草稿
    DocStatus.VOID,
  ],
  [DocStatus.APPROVED]: [
    DocStatus.PENDING_SYNC,
    DocStatus.COMPLETED, // 无需同步 U8 的单据可直接完成
    DocStatus.VOID,
  ],
  [DocStatus.PENDING_SYNC]: [DocStatus.SYNCED, DocStatus.SYNC_ERROR],
  [DocStatus.SYNC_ERROR]: [DocStatus.PENDING_SYNC, DocStatus.VOID],
  [DocStatus.SYNCED]: [DocStatus.REVERSED], // 已同步只能冲销
  [DocStatus.COMPLETED]: [],
  [DocStatus.VOID]: [],
  [DocStatus.REVERSED]: [],
};

export class DocStatusMachine {
  static canTransition(from: DocStatus, to: DocStatus): boolean {
    return (TRANSITIONS[from] ?? []).includes(to);
  }

  /** 非法迁移直接抛 BizException，返回迁移后的状态 */
  static transition(from: DocStatus, to: DocStatus): DocStatus {
    if (!this.canTransition(from, to)) {
      throw new BizException(
        'ILLEGAL_STATUS_TRANSITION',
        `Illegal doc status transition: ${from} -> ${to}`,
      );
    }
    return to;
  }

  /** 判断该状态是否允许编辑业务内容（草稿/驳回置回才可编辑） */
  static isEditable(status: DocStatus): boolean {
    return status === DocStatus.DRAFT;
  }

  /** 已同步单据禁止直接编辑，只能 REVERSED */
  static assertEditable(status: DocStatus): void {
    if (!this.isEditable(status)) {
      throw new BizException(
        'DOC_NOT_EDITABLE',
        `Document in status ${status} cannot be edited${
          status === DocStatus.SYNCED ? ' (SYNCED docs can only be REVERSED)' : ''
        }`,
      );
    }
  }
}
