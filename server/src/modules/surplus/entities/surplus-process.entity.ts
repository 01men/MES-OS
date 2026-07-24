import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 余料处理方式（三选一） */
export enum SurplusProcessMethod {
  RETURN_SUPPLIER = 'RETURN_SUPPLIER', // 退供应商（红字方向，正常库存不反向增加）
  REUSE_ORDER = 'REUSE_ORDER', // 用于后续订单（YL 调出 + 关联新工单占用）
  CROSS_TRANSFER = 'CROSS_TRANSFER', // 跨单挪用（生成调拨记录）
}

/** 余料处理记录：按实际处理数递减余料余额 */
@Entity('sur_process')
export class SurplusProcess {
  @PrimaryGeneratedColumn()
  id: number;

  /** 处理单号（SUR 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  @Column({ type: 'integer' })
  surplusId: number;

  /** 余料单号（冗余） */
  @Column({ type: 'varchar' })
  surplusDocNo: string;

  @Column({ type: 'varchar' })
  method: SurplusProcessMethod;

  @Column({ type: 'real' })
  qty: number;

  /** REUSE_ORDER 的目标工单 */
  @Column({ type: 'varchar', nullable: true })
  targetWorkOrderId: string;

  /** 关联单据（U8 退货单 / 调出批次 / 调拨关联单号） */
  @Column({ type: 'varchar', nullable: true })
  relatedDocNo: string;

  @Column({ type: 'varchar' })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;
}
