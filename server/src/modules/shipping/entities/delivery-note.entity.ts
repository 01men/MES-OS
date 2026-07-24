import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocStatus } from '../../../common/enums';

/**
 * 发货通知/发货任务（REQ-022）。
 * 来源：U8 增量拉取（source=U8，dnNo 为 U8 发货单号）或销售在系统内创建（source=SALES，SHP 编号）。
 * 状态走统一状态机：DRAFT(待发货) → PENDING_APPROVAL(少发审批中) → APPROVED(少发已批) →
 * PENDING_SYNC → SYNCED(已放行并同步 U8) / SYNC_ERROR；SYNCED → REVERSED(红字冲销)。
 */
@Entity('shp_delivery_note')
export class DeliveryNote {
  @PrimaryGeneratedColumn()
  id: number;

  /** 发货单号（U8 dnNo 或 SHP 编号），唯一 */
  @Column({ type: 'varchar', unique: true })
  dnNo: string;

  @Column({ type: 'varchar' })
  customerCode: string;

  @Column({ type: 'varchar', nullable: true })
  customerName: string;

  /** U8 | SALES */
  @Column({ type: 'varchar', default: 'U8' })
  source: string;

  @Column({ type: 'varchar', default: DocStatus.DRAFT })
  status: DocStatus;

  /** 装柜顺序：订单号(orderNo)数组 JSON；空表示默认按明细下单顺序 */
  @Column({ type: 'text', nullable: true })
  loadingSequence: string;

  /** 重复扫描计数（报警统计） */
  @Column({ type: 'integer', default: 0 })
  duplicateScanCount: number;

  /** 放行双确认：仓管员 */
  @Column({ type: 'varchar', nullable: true })
  keeperConfirmBy: string;

  @Column({ type: 'datetime', nullable: true })
  keeperConfirmAt: Date;

  /** 放行双确认：司机 */
  @Column({ type: 'varchar', nullable: true })
  driverName: string;

  @Column({ type: 'datetime', nullable: true })
  driverConfirmAt: Date;

  @Column({ type: 'datetime', nullable: true })
  releasedAt: Date;

  /** U8 侧更新时间（增量拉取游标参考） */
  @Column({ type: 'varchar', nullable: true })
  u8UpdatedAt: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
