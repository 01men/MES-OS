import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TransferStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 专用件待班组长审批
  APPROVED = 'APPROVED', // 审批通过，待过账
  POSTED = 'POSTED', // 已过账（占用已转移）
  REJECTED = 'REJECTED', // 审批驳回
}

export enum TransferKind {
  NORMAL = 'NORMAL', // 普通挪料
  REPLENISH = 'REPLENISH', // 到货补回的反向挪料
}

/**
 * 工单挪料单：源工单 → 目标工单。
 * 约束：仅 ACTIVE 占用可挪（CONSUMED 已实际消耗不得挪用）；禁止超挪；
 * 专用件（含未确认）跨工单挪料须班组长审批，禁止自审（审批引擎硬约束）。
 */
@Entity('trf_transfer')
export class TransferOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 挪料单号（TRF 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'varchar' })
  sourceWorkOrderId: string;

  @Column({ type: 'varchar' })
  targetWorkOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 批次（优先按批次挪），可空 */
  @Column({ type: 'varchar', nullable: true })
  batchNo: string;

  @Column({ type: 'real' })
  qty: number;

  /** 是否专用件管控（专用件/未确认件须审批） */
  @Column({ type: 'boolean', default: false })
  needApproval: boolean;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  @Column({ type: 'varchar', default: TransferStatus.POSTED })
  status: TransferStatus;

  @Column({ type: 'varchar', default: TransferKind.NORMAL })
  kind: TransferKind;

  /** 反向补回单关联的原挪料单号 */
  @Column({ type: 'varchar', nullable: true })
  relatedDocNo: string;

  /** 操作员（申请人） */
  @Column({ type: 'varchar' })
  operator: string;

  /** 审批人（专用件审批通过后记录） */
  @Column({ type: 'varchar', nullable: true })
  approver: string;

  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
