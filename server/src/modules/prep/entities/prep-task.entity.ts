import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 备料任务状态 */
export enum PrepTaskStatus {
  OPEN = 'OPEN', // 备料中
  SUSPENDED = 'SUSPENDED', // 暂存（中断），重登扫码自动恢复 OPEN
  COMPLETED = 'COMPLETED', // 已生成备料单
  CANCELLED = 'CANCELLED', // 已取消
}

/** 备料任务：按工单创建，持久化以支持中断重登恢复进度 */
@Entity('prep_task')
export class PrepTask {
  @PrimaryGeneratedColumn()
  id: number;

  /** 任务号（编号器 PT 前缀） */
  @Column({ type: 'varchar', unique: true })
  taskNo: string;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar', default: PrepTaskStatus.OPEN })
  status: PrepTaskStatus;

  /** 紧急生产跳过齐套检查标记 */
  @Column({ type: 'boolean', default: false })
  emergency: boolean;

  @Column({ type: 'varchar', nullable: true })
  emergencyReason: string;

  @Column({ type: 'varchar' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date;
}
