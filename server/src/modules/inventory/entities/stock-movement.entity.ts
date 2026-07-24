import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MovementType } from '../../../common/enums';

/** 库存流水：只增不改 */
@Entity('inv_stock_movement')
export class StockMovement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  type: MovementType;

  @Column({ type: 'varchar', nullable: true })
  packageNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 数量变化（入库为正，出库/核销为负，占用/释放不影响实物记 0） */
  @Column({ type: 'real' })
  qtyChange: number;

  @Column({ type: 'varchar', nullable: true })
  fromStatus: string;

  @Column({ type: 'varchar', nullable: true })
  toStatus: string;

  @Column({ type: 'varchar', nullable: true })
  fromLocation: string;

  @Column({ type: 'varchar', nullable: true })
  toLocation: string;

  @Column({ type: 'varchar' })
  docNo: string;

  @Column({ type: 'varchar', nullable: true })
  operator: string;

  /** 幂等键 */
  @Column({ type: 'varchar', nullable: true })
  requestId: string;

  @Column({ type: 'text', nullable: true })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;
}
