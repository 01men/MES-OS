import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SnapshotLineStatus {
  PENDING = 'PENDING', // 待盘
  COUNTED = 'COUNTED', // 初盘已提交
  RECOUNTED = 'RECOUNTED', // 复盘已提交
  POSTED = 'POSTED', // 差异已过账
}

/**
 * 盘点快照行（REQ-019）：任务生成时对范围内 StockLot 拍快照。
 * lineNo 全局唯一 = 任务号|库位|物料|批次，防重：同任务同物料同批次不得两次提交。
 */
@Entity('stk_snapshot')
export class StocktakeSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  taskId: number;

  /** 唯一行号：taskNo|locationCode|materialCode|batchNo */
  @Column({ type: 'varchar', unique: true })
  lineNo: string;

  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar' })
  batchNo: string;

  @Column({ type: 'varchar' })
  warehouseCode: string;

  @Column({ type: 'varchar' })
  locationCode: string;

  /** 快照账面数 */
  @Column({ type: 'real' })
  bookQty: number;

  /** 冻结前批次状态（硬冻结解冻恢复用） */
  @Column({ type: 'varchar', nullable: true })
  priorStatus: string;

  /** 初盘实盘数 */
  @Column({ type: 'real', nullable: true })
  actualQty: number;

  /** 复盘实盘数（第二人） */
  @Column({ type: 'real', nullable: true })
  recountQty: number;

  /** 是否超阈值需复盘 */
  @Column({ type: 'boolean', default: false })
  needRecount: boolean;

  /** 差异原因（超阈值必填） */
  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ type: 'varchar', default: SnapshotLineStatus.PENDING })
  status: SnapshotLineStatus;

  @Column({ type: 'varchar', nullable: true })
  countedBy: string;

  @Column({ type: 'varchar', nullable: true })
  recountedBy: string;

  /** 过账时写入的目标账面（=最终实盘） */
  @Column({ type: 'real', nullable: true })
  postedQty: number;

  @CreateDateColumn()
  createdAt: Date;
}
