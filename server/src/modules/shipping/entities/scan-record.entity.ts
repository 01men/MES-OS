import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** 出库扫码记录：(noteId, serialNo) 唯一，重复扫描在应用层阻止并返回原扫码时间/人员 */
@Entity('shp_scan_record')
@Unique(['noteId', 'serialNo'])
export class ScanRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer' })
  noteId: number;

  @Column({ type: 'integer' })
  lineId: number;

  @Column({ type: 'varchar' })
  orderNo: string;

  @Index()
  @Column({ type: 'varchar' })
  serialNo: string;

  @Column({ type: 'varchar' })
  productCode: string;

  @Column({ type: 'varchar' })
  operator: string;

  @Column({ type: 'datetime' })
  scannedAt: Date;
}
