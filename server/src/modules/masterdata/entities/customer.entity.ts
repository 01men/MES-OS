import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('md_customer')
export class Customer {
  @PrimaryColumn({ type: 'varchar' })
  customerCode: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  contact: string;
}
