import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum StocktakeTaskType {
  CYCLE = 'CYCLE', // 循环盘点
  ANNUAL = 'ANNUAL', // 年度盘点
}

export enum StocktakeTaskStatus {
  OPEN = 'OPEN', // 待盘
  COUNTING = 'COUNTING', // 盘点中
  COMPLETED = 'COMPLETED', // 差异已过账完成
}

export enum FreezeMode {
  NONE = 'NONE',
  HARD = 'HARD', // 硬冻结：批次转 FROZEN
  SOFT = 'SOFT', // 软冻结：以快照为基准，变动隔离记录
}

/**
 * 盘点任务。唯一约束 (strategyId, generatedDate) 保证同日重复生成幂等。
 * blind=true 为盲盘（A 类及高风险默认）：初盘人查询不返回账面数。
 */
@Entity('stk_task')
@Unique(['strategyId', 'generatedDate'])
export class StocktakeTask {
  @PrimaryGeneratedColumn()
  id: number;

  /** 任务号（编号器 STK 前缀） */
  @Column({ type: 'varchar', unique: true })
  taskNo: string;

  @Column({ type: 'varchar' })
  taskType: StocktakeTaskType;

  /** 来源策略，年度盘点等手工任务可空 */
  @Column({ type: 'integer', nullable: true })
  strategyId: number;

  /** 生成日期 yyyy-MM-dd（与 strategyId 联合唯一，同日幂等） */
  @Column({ type: 'varchar' })
  generatedDate: string;

  @Column({ type: 'varchar', default: StocktakeTaskStatus.OPEN })
  status: StocktakeTaskStatus;

  /** 盲盘标志 */
  @Column({ type: 'boolean', default: false })
  blind: boolean;

  @Column({ type: 'varchar', default: FreezeMode.NONE })
  freezeMode: FreezeMode;

  /** 冻结是否已生效（SOFT 需审批通过后生效） */
  @Column({ type: 'boolean', default: false })
  freezeActive: boolean;

  /** 软冻结审批单 ID */
  @Column({ type: 'integer', nullable: true })
  softApprovalId: number;

  /** 差异调整审批单 ID */
  @Column({ type: 'integer', nullable: true })
  adjustApprovalId: number;

  /** 责任人（默认取策略责任人） */
  @Column({ type: 'varchar', nullable: true })
  ownerUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
