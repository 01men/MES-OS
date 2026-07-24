import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 备料任务行：按工单有效 BOM 展开，preparedQty 由扫码累计 */
@Entity('prep_task_line')
export class PrepTaskLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  taskId: number;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 应备数量 = BOM 用量 × 工单计划数 */
  @Column({ type: 'real' })
  requiredQty: number;

  /** 已备数量（扫码累计，重复扫码不重复累计） */
  @Column({ type: 'real', default: 0 })
  preparedQty: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;
}
