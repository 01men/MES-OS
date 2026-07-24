import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DefectStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * 不良品处理记录：不良退料的前置条件。
 * 不良退料必须关联已审批的不良记录且登记数量 ≥ 本次退料数。
 */
@Entity('rtn_defect')
export class DefectRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** 不良记录单号（DEF 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar' })
  reason: string;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  @Column({ type: 'varchar', default: DefectStatus.PENDING_APPROVAL })
  status: DefectStatus;

  @Column({ type: 'varchar' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
