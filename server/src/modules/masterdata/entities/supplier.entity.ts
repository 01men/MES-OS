import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('md_supplier')
export class Supplier {
  @PrimaryColumn({ type: 'varchar' })
  supplierCode: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  contact: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string;
}
