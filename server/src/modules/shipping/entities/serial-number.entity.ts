import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/** 成品序列号主数据：成品入库产生；状态 在库 IN_STOCK / 已出库 SHIPPED */
@Entity('shp_serial_number')
export class SerialNumber {
  @PrimaryColumn({ type: 'varchar' })
  serialNo: string;

  @Column({ type: 'varchar' })
  productCode: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  batchNo: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  workOrderId: string;

  /** IN_STOCK 在库 | SHIPPED 已出库 */
  @Column({ type: 'varchar', default: 'IN_STOCK' })
  status: string;

  @Column({ type: 'integer', nullable: true })
  shippedNoteId: number;

  @Column({ type: 'varchar', nullable: true })
  shippedDnNo: string;

  @Column({ type: 'datetime', nullable: true })
  shippedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
