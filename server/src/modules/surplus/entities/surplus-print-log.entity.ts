import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 余料标签打印留痕 */
@Entity('sur_print_log')
export class SurplusPrintLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  surplusId: number;

  @Column({ type: 'varchar' })
  docNo: string;

  /** PRINT 首打 / REPRINT 补打 */
  @Column({ type: 'varchar' })
  printType: string;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;
}
