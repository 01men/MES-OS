import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum QTransferStatus {
  DRAFT = 'DRAFT', // 待质检电子签确认
  CONFIRMED = 'CONFIRMED', // 已签署，待过账（不良调回良品另需审批）
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 不良调回良品，待质量审批
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
}

/**
 * 良/不良调拨单（REQ-021）：QUALIFIED ↔ ISOLATED 双向。
 * 必须质检员或质量工程师电子签确认（confirm 接口记录签署人）否则无法过账；
 * 不良调回良品须重新走审批；反向调拨不直接改原单（新建反向单关联原单）。
 */
@Entity('rtn_qtransfer')
export class QualityTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  /** 调拨单号（QT 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar', nullable: true })
  batchNo: string;

  /** 调拨的库存批次（整包调拨，过账后两边库存平衡） */
  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'real' })
  qty: number;

  /** QUALIFIED / ISOLATED */
  @Column({ type: 'varchar' })
  fromStatus: string;

  /** QUALIFIED / ISOLATED */
  @Column({ type: 'varchar' })
  toStatus: string;

  @Column({ type: 'varchar' })
  fromLocation: string;

  @Column({ type: 'varchar', nullable: true })
  toLocation: string;

  @Column({ type: 'varchar' })
  reason: string;

  /** 质检电子签：签署人 / 角色 / 时间 */
  @Column({ type: 'varchar', nullable: true })
  confirmBy: string;

  @Column({ type: 'varchar', nullable: true })
  confirmRole: string;

  @Column({ type: 'datetime', nullable: true })
  confirmedAt: Date;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  /** 反向调拨单关联的原单号（原单不改写） */
  @Column({ type: 'varchar', nullable: true })
  reverseOfDocNo: string;

  @Column({ type: 'varchar', default: QTransferStatus.DRAFT })
  status: QTransferStatus;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;
}
