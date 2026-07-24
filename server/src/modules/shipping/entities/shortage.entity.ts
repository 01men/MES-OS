import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 欠发记录：少发申请时生成，审批通过后允许部分放行；欠发与补发状态持续留存 */
@Entity('shp_shortage')
export class Shortage {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer' })
  noteId: number;

  @Column({ type: 'varchar' })
  orderNo: string;

  @Column({ type: 'varchar' })
  productCode: string;

  /** 欠发数量 */
  @Column({ type: 'real' })
  qty: number;

  /** 少发原因（必填） */
  @Column({ type: 'varchar' })
  reason: string;

  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  /** PENDING_APPROVAL | APPROVED | REJECTED */
  @Column({ type: 'varchar', default: 'PENDING_APPROVAL' })
  status: string;

  /** 补发状态：OPEN 待补发 | RESHIPPED 已补发 */
  @Column({ type: 'varchar', default: 'OPEN' })
  reshipStatus: string;

  @CreateDateColumn()
  createdAt: Date;
}
