import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 发货通知明细：一行 = 某销售订单(orderNo) 下某成品的应发数量 */
@Entity('shp_delivery_note_line')
export class DeliveryNoteLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer' })
  noteId: number;

  /** 销售订单号；U8 未提供时取发货单号（单订单场景） */
  @Column({ type: 'varchar' })
  orderNo: string;

  @Column({ type: 'varchar' })
  productCode: string;

  /** 应发数量 */
  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;

  /** 默认装柜顺序（下单先后） */
  @Column({ type: 'integer', default: 0 })
  sortOrder: number;
}
