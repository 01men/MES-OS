import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocStatus } from '../../../common/enums';

/**
 * 备料单（发料单）：备料任务完成时生成，只增加 MES 占用（U8 现存量不变）。
 * 物权交接双确认后 → PENDING_SYNC → U8 材料出库单 SYNCED → 扣实物+释放占用。
 * 初始状态 APPROVED（备料单生成即生效，无需审批环节）。
 */
@Entity('prep_order')
export class PrepOrder {
  @PrimaryGeneratedColumn()
  id: number;

  /** 备料单号（编号器 PREP 前缀），占用/释放/核销的粒度 */
  @Column({ type: 'varchar', unique: true })
  prepDocNo: string;

  @Column({ type: 'varchar' })
  taskNo: string;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar', default: DocStatus.APPROVED })
  status: DocStatus;

  // ---- 物权交接双确认（必须两个不同账号） ----
  @Column({ type: 'varchar', nullable: true })
  keeperBy: string;

  @Column({ type: 'datetime', nullable: true })
  keeperAt: Date;

  @Column({ type: 'varchar', nullable: true })
  keeperDevice: string;

  @Column({ type: 'varchar', nullable: true })
  receiverBy: string;

  @Column({ type: 'datetime', nullable: true })
  receiverAt: Date;

  @Column({ type: 'varchar', nullable: true })
  receiverDevice: string;

  /** U8 同步任务 id（材料出库单） */
  @Column({ type: 'integer', nullable: true })
  u8SyncTaskId: number;

  /** U8 过账时间（= 实物扣减时间） */
  @Column({ type: 'datetime', nullable: true })
  postedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
