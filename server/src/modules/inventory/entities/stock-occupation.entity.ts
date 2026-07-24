import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OccupationStatus } from '../../../common/enums';

/** 库存占用：备料按工单占用物料可用量 */
@Entity('inv_stock_occupation')
export class StockOccupation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 占用归属仓库；历史数据可为空。 */
  @Column({ type: 'varchar', nullable: true })
  warehouseCode: string | null;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar', default: OccupationStatus.ACTIVE })
  status: OccupationStatus;

  /** 备料单号（释放/核销的粒度） */
  @Column({ type: 'varchar' })
  prepDocNo: string;

  @CreateDateColumn()
  createdAt: Date;
}
