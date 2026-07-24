import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * 扫码备料记录：每次扫描一行（分次备料留痕：时间/数量/操作员/设备）。
 * (taskId, packageNo) 唯一 → 同一包装码重复扫描不重复累计。
 */
@Entity('prep_scan_record')
@Unique(['taskId', 'packageNo'])
export class PrepScanRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  taskId: number;

  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar' })
  operator: string;

  @Column({ type: 'varchar', nullable: true })
  device: string;

  @CreateDateColumn()
  scannedAt: Date;
}
