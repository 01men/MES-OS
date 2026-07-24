import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StockStatus } from '../../../common/enums';

/** 库存批次行：最小包装（packageNo 唯一）维度 */
@Entity('inv_stock_lot')
export class StockLot {
  @PrimaryGeneratedColumn()
  id: number;

  /** 最小包装唯一号 */
  @Column({ type: 'varchar', unique: true })
  packageNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar' })
  batchNo: string;

  @Column({ type: 'varchar' })
  warehouseCode: string;

  @Column({ type: 'varchar' })
  locationCode: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar' })
  status: StockStatus;

  /** 专用件绑定的工单，可空 */
  @Column({ type: 'varchar', nullable: true })
  workOrderId: string;

  @Column({ type: 'varchar' })
  sourceDocNo: string;

  @Column({ type: 'datetime' })
  receivedAt: Date;

  /** 失效日期（由 shelfLifeDays 推算或显式传入），可空 */
  @Column({ type: 'datetime', nullable: true })
  expiryDate: Date;

  @CreateDateColumn()
  createdAt: Date;
}
