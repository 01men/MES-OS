import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 软冻结期间的变动隔离记录（REQ-020）：
 * 软冻结以快照为基准，冻结期间范围内批次的出入库/调整等变动逐笔隔离记录于此，
 * 解冻时按 账面=快照+冻结后合法变动 逐笔对账生成对账清单。
 */
@Entity('stk_frozen_movement')
export class StocktakeFrozenMovement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  taskId: number;

  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 变动类型（出入库/调整等，对齐 MovementType） */
  @Column({ type: 'varchar' })
  movementType: string;

  /** 数量变化（入库为正，出库为负） */
  @Column({ type: 'real' })
  qtyChange: number;

  /** 来源单据号 */
  @Column({ type: 'varchar' })
  docNo: string;

  @Column({ type: 'varchar', nullable: true })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;
}
