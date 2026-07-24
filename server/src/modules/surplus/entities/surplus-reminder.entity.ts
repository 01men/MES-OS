import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ReminderStatus {
  PENDING = 'PENDING', // 待办
  DONE = 'DONE', // 已处理
}

/**
 * 余料提醒：按 RuleConfig surplus.remindDays（默认 [3,7,15]）到期生成。
 * 提醒对象：有余料来源工单 → 该工单 PMC；否则 → 仓库主管。
 */
@Entity('sur_reminder')
export class SurplusReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  surplusId: number;

  /** 余料单号（冗余，便于展示） */
  @Column({ type: 'varchar' })
  docNo: string;

  /** 第几次提醒 */
  @Column({ type: 'integer' })
  remindCount: number;

  /** 触发的提醒天数（3/7/15…） */
  @Column({ type: 'integer' })
  remindDay: number;

  /** 提醒对象角色：PMC / WH_MANAGER */
  @Column({ type: 'varchar' })
  targetRole: string;

  /** 提醒对象关联（来源工单号，可空） */
  @Column({ type: 'varchar', nullable: true })
  targetRef: string;

  @Column({ type: 'varchar', default: ReminderStatus.PENDING })
  status: ReminderStatus;

  @CreateDateColumn()
  createdAt: Date;
}
