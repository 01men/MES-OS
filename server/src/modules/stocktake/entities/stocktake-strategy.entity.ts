import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 盘点策略范围类型 */
export enum StocktakeScopeType {
  /** 按 ABC 分类（scopeValue = A/B/C） */
  ABC = 'ABC',
  /** 指定物料（scopeValue = JSON 数组 materialCode[]） */
  MATERIAL = 'MATERIAL',
  /** 指定库区（scopeValue = areaCode） */
  AREA = 'AREA',
}

/**
 * 循环盘点策略（REQ-018）：
 * 按范围（ABC 类/指定物料/指定库区）+ 周期天数 + 责任人定义盘点频率。
 * 默认 A 类 30 天、B 类 90 天、C 类 180 天（建策略时由调用方传入，可配）。
 */
@Entity('stk_strategy')
export class StocktakeStrategy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  scopeType: StocktakeScopeType;

  /** ABC 类码 / materialCode JSON 数组 / areaCode */
  @Column({ type: 'varchar' })
  scopeValue: string;

  /** 盘点周期天数 */
  @Column({ type: 'integer' })
  cycleDays: number;

  /** 责任人（用户名） */
  @Column({ type: 'varchar' })
  ownerUserId: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
