import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('md_work_order')
export class WorkOrder {
  @PrimaryColumn({ type: 'varchar' })
  workOrderId: string;

  @Column({ type: 'varchar' })
  productCode: string;

  @Column({ type: 'real' })
  planQty: number;

  @Column({ type: 'varchar', nullable: true })
  planDate: string;

  @Column({ type: 'varchar', default: 'RELEASED' })
  status: string;
}
