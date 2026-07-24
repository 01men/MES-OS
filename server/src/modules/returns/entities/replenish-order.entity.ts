import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 补料类型（纪要） */
export enum ReplenishType {
  TRANSFER_ONLY = 'TRANSFER_ONLY', // 余量调拨：无需补料，仅记录
  RETURN_AND_REPLENISH = 'RETURN_AND_REPLENISH', // 一退一补：退不良交接完成才可补
  DIRECT = 'DIRECT', // 直接补料
}

export enum ReplenishStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 超领待车间主任审批
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
}

/**
 * 补料单（REQ-016 超领管控）。
 * 超领 =（累计已领+本次）> BOM 计划 × (1 + RuleConfig returns.overIssueRate)
 * → 触发车间主任审批，OVR 独立编号、单独统计、不计入正常损耗。
 */
@Entity('rtn_replenish')
export class ReplenishOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 补料单号：正常 RTN 前缀；超领 OVR 前缀 */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'varchar' })
  type: ReplenishType;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'real' })
  qty: number;

  /** 一退一补关联的退料单号（要求退料交接完成） */
  @Column({ type: 'varchar', nullable: true })
  relatedReturnDocNo: string;

  /** 是否超领单（OVR 独立编号，单独统计，不计入正常损耗） */
  @Column({ type: 'boolean', default: false })
  isOver: boolean;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  @Column({ type: 'varchar', default: ReplenishStatus.POSTED })
  status: ReplenishStatus;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;
}
