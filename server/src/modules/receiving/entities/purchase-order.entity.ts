import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 采购订单来源单据类型：委外识别依据（而非供应商编码） */
export enum PoOrderType {
  NORMAL = 'NORMAL',
  OUTSOURCE = 'OUTSOURCE',
}

/** 采购订单头（从 U8 同步，重复拉取按 poNo upsert 幂等） */
@Entity('rcv_purchase_order')
export class RcvPurchaseOrder {
  @PrimaryColumn({ type: 'varchar' })
  poNo: string;

  @Column({ type: 'varchar' })
  supplierCode: string;

  /** NORMAL / OUTSOURCE */
  @Column({ type: 'varchar', default: PoOrderType.NORMAL })
  orderType: string;

  /** OPEN / CLOSED */
  @Column({ type: 'varchar', default: 'OPEN' })
  status: string;

  /** U8 侧最后更新时间（增量拉取游标），可空 */
  @Column({ type: 'varchar', nullable: true })
  sourceUpdatedAt: string;

  @CreateDateColumn()
  createdAt: Date;
}

/** 采购订单行 */
@Entity('rcv_purchase_order_line')
@Index(['poNo', 'materialCode'], { unique: true })
export class RcvPurchaseOrderLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  poNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 订单数量 */
  @Column({ type: 'real' })
  qty: number;

  /** 已收数量（确认入库后累加） */
  @Column({ type: 'real', default: 0 })
  receivedQty: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;
}
