import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 损耗原因 */
export enum WriteoffReason {
  CUSTOMER_INSPECT = 'CUSTOMER_INSPECT', // 客检（客户订单号必填）
  DESTRUCTIVE_TEST = 'DESTRUCTIVE_TEST', // 破坏性测试
  OTHER = 'OTHER',
}

export enum WriteoffStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 质量工程师+财务双审批中
  POSTED = 'POSTED', // 已过账（adjust 扣减 + U8 同步）
  VOID = 'VOID', // 任一审批拒绝即作废，不得过账
}

/**
 * 损耗核销单（REQ-017）：质量工程师 + 财务双审批，任一拒绝即作废；
 * 通过后 InventoryService.adjust 扣减 + SyncService 同步 U8，
 * 核销单 / U8 单据 / 台账一一对应（bizKey = 核销单号）。
 */
@Entity('rtn_writeoff')
export class WriteoffOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 核销单号（LS 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  /** 工单号（可选） */
  @Column({ type: 'varchar', nullable: true })
  workOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar' })
  batchNo: string;

  /** 扣减的库存批次 */
  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar' })
  reason: WriteoffReason;

  /** 客户订单号（客检必填） */
  @Column({ type: 'varchar', nullable: true })
  customerOrderNo: string;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  @Column({ type: 'varchar', default: WriteoffStatus.PENDING_APPROVAL })
  status: WriteoffStatus;

  /** U8 同步任务是否完成（核销单↔U8 单据一一对应） */
  @Column({ type: 'boolean', default: false })
  u8Synced: boolean;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;
}
