import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { BomItem } from './bom-item.entity';

@Entity('md_bom')
export class Bom {
  @PrimaryColumn({ type: 'varchar' })
  bomCode: string;

  @Column({ type: 'varchar' })
  productCode: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @OneToMany(() => BomItem, (item) => item.bom, { cascade: true, eager: true })
  items: BomItem[];
}
