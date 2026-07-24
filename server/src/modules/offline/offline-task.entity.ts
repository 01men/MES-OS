import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OfflineStatus } from '../../common/enums';

/** 离线任务：设备断网缓存的业务操作，恢复后同步 */
@Entity('offline_task')
export class OfflineTask {
  @PrimaryGeneratedColumn()
  id: number;

  /** 设备号（PDA/平板） */
  @Column({ type: 'varchar' })
  deviceId: string;

  @Column({ type: 'varchar' })
  operatorId: string;

  /** 设备侧唯一任务号（幂等键） */
  @Column({ type: 'varchar', unique: true })
  taskNo: string;

  /** 业务发生时间（设备本地时间） */
  @Column({ type: 'datetime' })
  bizTime: Date;

  /** 业务负载 JSON */
  @Column({ type: 'text' })
  payload: string;

  @Column({ type: 'varchar', default: OfflineStatus.PENDING })
  status: OfflineStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
