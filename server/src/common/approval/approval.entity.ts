import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalStatus } from '../enums';

export interface ApprovalStep {
  /** 指定审批角色（按角色审批） */
  approverRole?: string;
  /** 指定审批人（按人审批） */
  userId?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  actedBy?: string;
  actedAt?: string;
  comment?: string;
}

/**
 * 审批单。支持多级（含双审批：两个 step 都过才 APPROVED）。
 * 硬约束由 ApprovalEngineService 保证：禁止自审。
 */
@Entity('approval')
export class Approval {
  @PrimaryGeneratedColumn()
  id: number;

  /** 业务类型，如 BizType.PREP */
  @Column({ type: 'varchar' })
  bizType: string;

  /** 业务单据 ID/单号 */
  @Column({ type: 'varchar' })
  bizId: string;

  @Column({ type: 'varchar' })
  applicantId: string;

  /** ApprovalStep[] JSON */
  @Column({ type: 'text' })
  steps: string;

  @Column({ type: 'integer', default: 0 })
  currentStep: number;

  @Column({ type: 'varchar', default: ApprovalStatus.PENDING })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
