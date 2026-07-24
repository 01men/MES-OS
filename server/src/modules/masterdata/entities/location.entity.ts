import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('md_location')
export class Location {
  @PrimaryColumn({ type: 'varchar' })
  locationCode: string;

  @Column({ type: 'varchar' })
  warehouseCode: string;

  /** 库区码；余料区固定为 YL */
  @Column({ type: 'varchar' })
  areaCode: string;

  @Column({ type: 'varchar', nullable: true })
  name: string;
}
