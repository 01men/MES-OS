import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocStatus } from '../../../common/enums';

/** 红字冲销单：放行（SYNCED）后原单锁定，只能以此受控更正；原单保留并置 REVERSED */
@Entity('shp_reversal_doc')
export class ReversalDoc {
  @PrimaryGeneratedColumn()
  id: number;

  /** 冲销单号（SHP 编号），唯一 */
  @Column({ type: 'varchar', unique: true })
  reversalNo: string;

  @Column({ type: 'integer' })
  noteId: number;

  /** 被冲销的发货单号 */
  @Column({ type: 'varchar' })
  dnNo: string;

  @Column({ type: 'varchar' })
  reason: string;

  @Column({ type: 'varchar' })
  status: DocStatus;

  @Column({ type: 'varchar' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
