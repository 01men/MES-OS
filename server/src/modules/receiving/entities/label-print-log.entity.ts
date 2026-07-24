import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 标签打印日志：首次打印与补打留痕（补打必须记录原因） */
@Entity('rcv_label_print_log')
export class LabelPrintLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'varchar' })
  arrivalNo: string;

  /** INITIAL / REPRINT */
  @Column({ type: 'varchar' })
  printType: string;

  /** 补打原因（REPRINT 必填），可空 */
  @Column({ type: 'text', nullable: true })
  reason: string;

  /** 第几次打印（1=首次） */
  @Column({ type: 'integer' })
  printSeq: number;

  @Column({ type: 'varchar' })
  printedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
