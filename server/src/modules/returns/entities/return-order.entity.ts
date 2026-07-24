import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 退料类型 */
export enum ReturnType {
  DEFECT = 'DEFECT', // 不良退料 → ISOLATED
  OVER_ISSUE = 'OVER_ISSUE', // 超领退料
  NORMAL = 'NORMAL', // 正常退料
}

export enum ReturnStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // 超退待仓库主管审批
  POSTED = 'POSTED', // 已过账入库
  REJECTED = 'REJECTED',
}

/**
 * 退料单（REQ-015/016）。
 * 超退（超出 累计领用−累计消耗−累计已退 上限）强制填原因 + 仓库主管审批，
 * 独立编号（OVR 前缀）、单独统计、不计入正常损耗。
 */
@Entity('rtn_return')
export class ReturnOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 退料单号：正常 RTN 前缀；超退 OVR 前缀 */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'varchar' })
  type: ReturnType;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar', nullable: true })
  batchNo: string;

  @Column({ type: 'real' })
  qty: number;

  /** 退料入库状态：ISOLATED / QUALIFIED */
  @Column({ type: 'varchar' })
  toStatus: string;

  /** 关联不良品处理记录（不良退料必填） */
  @Column({ type: 'varchar', nullable: true })
  defectDocNo: string;

  /** 是否超退单（OVR 独立编号，单独统计，不计入正常损耗） */
  @Column({ type: 'boolean', default: false })
  isOver: boolean;

  /** 超退强制填写的原因 */
  @Column({ type: 'varchar', nullable: true })
  reason: string;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  @Column({ type: 'varchar', default: ReturnStatus.POSTED })
  status: ReturnStatus;

  /** 退料入库批次（packageNo） */
  @Column({ type: 'varchar', nullable: true })
  returnPackageNo: string;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;
}
