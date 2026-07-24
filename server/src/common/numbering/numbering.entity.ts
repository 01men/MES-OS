import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 单据编号规则表：按 类型码+日期 记录当日流水，作废号不复用 */
@Entity('numbering_sequence')
@Unique(['typeCode', 'dateStr'])
export class NumberingSequence {
  @PrimaryGeneratedColumn()
  id: number;

  /** 类型码，如 RCV / PREP */
  @Column({ type: 'varchar' })
  typeCode: string;

  /** yyyyMMdd */
  @Column({ type: 'varchar' })
  dateStr: string;

  /** 当日已用最大流水号 */
  @Column({ type: 'integer', default: 0 })
  lastSeq: number;
}
