import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ReplenishTodoStatus {
  OPEN = 'OPEN', // 待补回
  CLOSED = 'CLOSED', // PMC 确认并创建反向挪料单后关闭
}

/**
 * 补料待办（REQ-014）：物料到货后扫描曾被挪出的工单生成。
 * 原挪料记录保留不改写；补回通过新建反向挪料单完成。
 */
@Entity('trf_replenish_todo')
export class ReplenishTodo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 原工单（被挪出方） */
  @Column({ type: 'varchar' })
  workOrderId: string;

  /** 原挪料单号 */
  @Column({ type: 'varchar' })
  transferDocNo: string;

  /** 挪用数量 */
  @Column({ type: 'real' })
  movedQty: number;

  /** 已补回数量 */
  @Column({ type: 'real', default: 0 })
  replenishedQty: number;

  /** PMC 确认后创建的反向挪料单号 */
  @Column({ type: 'varchar', nullable: true })
  reverseDocNo: string;

  @Column({ type: 'varchar', default: ReplenishTodoStatus.OPEN })
  status: ReplenishTodoStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date;
}
