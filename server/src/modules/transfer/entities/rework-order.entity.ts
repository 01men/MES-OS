import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ReworkStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED', // 已批准（允许返工发料）
  REJECTED = 'REJECTED',
  ISSUED = 'ISSUED', // 返工发料完成
}

/**
 * 返工单（纪要·返工流程）：返工须先申请并审批；
 * 无已批准返工单时返工领料被拒，防止未补料即返工。
 */
@Entity('trf_rework')
export class ReworkOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 返工单号（RWK 前缀） */
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

  @Column({ type: 'varchar', default: ReworkStatus.PENDING_APPROVAL })
  status: ReworkStatus;

  @Column({ type: 'varchar' })
  applicant: string;

  /** 返工发料的核销备料单号 */
  @Column({ type: 'varchar', nullable: true })
  issuePrepDocNo: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  issuedAt: Date;
}
