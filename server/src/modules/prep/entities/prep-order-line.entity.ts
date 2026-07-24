import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 备料单行：完成备料时的需求/实备快照。
 * preparedQty > requiredQty 的部分为「已备未用」余料（leftoverReminder 数据源）。
 */
@Entity('prep_order_line')
export class PrepOrderLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  prepDocNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'real' })
  requiredQty: number;

  @Column({ type: 'real' })
  preparedQty: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;
}
