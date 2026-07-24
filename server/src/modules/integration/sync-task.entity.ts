import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocStatus } from '../../common/enums';

/** 同步任务：单据置 PENDING_SYNC 后入队，由 SyncService 推送 U8 */
@Entity('sync_task')
export class SyncTask {
  @PrimaryGeneratedColumn()
  id: number;

  /** 业务模块，如 receiving / prep */
  @Column({ type: 'varchar' })
  bizType: string;

  /** 业务键（单据号），唯一 */
  @Column({ type: 'varchar', unique: true })
  bizKey: string;

  @Column({ type: 'varchar' })
  voucherType: string;

  @Column({ type: 'text' })
  payload: string;

  /** 仅使用 PENDING_SYNC / SYNCED / SYNC_ERROR（状态机校验迁移） */
  @Column({ type: 'varchar' })
  status: DocStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string;

  /** 最终失败后的告警记录 */
  @Column({ type: 'text', nullable: true })
  alarm: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
