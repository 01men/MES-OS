import { describe, expect, it } from 'vitest';
import { DocStatusMachine } from '../../src/common/doc-status.machine';
import { DocStatus } from '../../src/common/enums';
import { BizException } from '../../src/common/exceptions';

describe('DocStatusMachine 单据状态机', () => {
  it('主链路合法迁移全部放行', () => {
    const chain: [DocStatus, DocStatus][] = [
      [DocStatus.DRAFT, DocStatus.PENDING_APPROVAL],
      [DocStatus.PENDING_APPROVAL, DocStatus.APPROVED],
      [DocStatus.APPROVED, DocStatus.PENDING_SYNC],
      [DocStatus.PENDING_SYNC, DocStatus.SYNCED],
      [DocStatus.SYNCED, DocStatus.REVERSED],
    ];
    for (const [from, to] of chain) {
      expect(DocStatusMachine.canTransition(from, to)).toBe(true);
      expect(DocStatusMachine.transition(from, to)).toBe(to);
    }
  });

  it('异常分支：PENDING_SYNC ↔ SYNC_ERROR 可互转，驳回置回草稿', () => {
    expect(DocStatusMachine.canTransition(DocStatus.PENDING_SYNC, DocStatus.SYNC_ERROR)).toBe(true);
    expect(DocStatusMachine.canTransition(DocStatus.SYNC_ERROR, DocStatus.PENDING_SYNC)).toBe(true);
    expect(DocStatusMachine.canTransition(DocStatus.PENDING_APPROVAL, DocStatus.DRAFT)).toBe(true);
  });

  it('非法迁移抛 BizException', () => {
    const illegal: [DocStatus, DocStatus][] = [
      [DocStatus.DRAFT, DocStatus.SYNCED],
      [DocStatus.DRAFT, DocStatus.APPROVED],
      [DocStatus.PENDING_SYNC, DocStatus.DRAFT],
      [DocStatus.SYNC_ERROR, DocStatus.SYNCED], // 必须先回 PENDING_SYNC
      [DocStatus.VOID, DocStatus.DRAFT],
      [DocStatus.REVERSED, DocStatus.DRAFT],
      [DocStatus.COMPLETED, DocStatus.VOID],
    ];
    for (const [from, to] of illegal) {
      expect(DocStatusMachine.canTransition(from, to)).toBe(false);
      expect(() => DocStatusMachine.transition(from, to)).toThrow(BizException);
    }
  });

  it('已 SYNCED 只能 REVERSED，直接编辑被拒', () => {
    for (const to of Object.values(DocStatus)) {
      const ok = DocStatusMachine.canTransition(DocStatus.SYNCED, to);
      expect(ok).toBe(to === DocStatus.REVERSED);
    }
    expect(() => DocStatusMachine.assertEditable(DocStatus.SYNCED)).toThrow(BizException);
    expect(() => DocStatusMachine.assertEditable(DocStatus.DRAFT)).not.toThrow();
  });
});
