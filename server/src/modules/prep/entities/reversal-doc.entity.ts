import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocStatus } from '../../../common/enums';

/**
 * 差异单（更正单）：备料单 U8 过账后只允许走更正。
 * 创建后原备料单状态机走 SYNCED → REVERSED（原单保留，不删除）。
 */
@Entity('prep_reversal_doc')
export class ReversalDoc {
  @PrimaryGeneratedColumn()
  id: number;

  /** 差异单号（编号器 RVS 前缀） */
  @Column({ type: 'varchar', unique: true })
  reversalNo: string;

  /** 被更正的备料单号 */
  @Column({ type: 'varchar' })
  prepDocNo: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'varchar', default: DocStatus.COMPLETED })
  status: DocStatus;

  @Column({ type: 'varchar' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
