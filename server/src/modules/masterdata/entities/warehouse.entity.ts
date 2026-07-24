import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('md_warehouse')
export class Warehouse {
  @PrimaryColumn({ type: 'varchar' })
  warehouseCode: string;

  @Column({ type: 'varchar' })
  name: string;
}
