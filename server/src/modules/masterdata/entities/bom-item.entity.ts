import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Bom } from './bom.entity';

@Entity('md_bom_item')
export class BomItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  bomCode: string;

  @ManyToOne(() => Bom, (b) => b.items)
  @JoinColumn({ name: 'bomCode' })
  bom: Bom;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;
}
