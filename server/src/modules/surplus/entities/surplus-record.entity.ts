import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 余料来源类型 */
export enum SurplusSourceType {
  SUPPLIER_EXTRA = 'SUPPLIER_EXTRA', // 供应商多送
  WORK_ORDER_LEFT = 'WORK_ORDER_LEFT', // 工单剩余
  WORKSHOP_RETURN = 'WORKSHOP_RETURN', // 车间退料
  PREP_LEFTOVER = 'PREP_LEFTOVER', // 发料剩余（prep 模块 leftoverReminder 场景）
}

export enum SurplusStatus {
  OPEN = 'OPEN', // 待处理
  CLOSED = 'CLOSED', // 余额为 0，已关闭
}

/** 余料记录：整包入 YL 余料区，独立记账不计入正常可用库存 */
@Entity('sur_record')
export class SurplusRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** 余料单号（SUR 前缀） */
  @Column({ type: 'varchar', unique: true })
  docNo: string;

  /** 关联库存批次（最小包装） */
  @Column({ type: 'varchar' })
  packageNo: string;

  @Column({ type: 'varchar' })
  sourceType: SurplusSourceType;

  /** 来源单据号（订单号/工单号/退料单号/备料单号） */
  @Column({ type: 'varchar' })
  sourceDocNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar' })
  materialName: string;

  /** 产生时的原始数量 */
  @Column({ type: 'real' })
  originalQty: number;

  /** 剩余数量：按实际处理数递减，为 0 才关闭 */
  @Column({ type: 'real' })
  qty: number;

  /** 产生日期 */
  @Column({ type: 'datetime' })
  occurredAt: Date;

  /** 责任人 */
  @Column({ type: 'varchar' })
  responsible: string;

  /** 来源工单（可空） */
  @Column({ type: 'varchar', nullable: true })
  workOrderId: string;

  /** 入余料区前的仓库/库位（REUSE 调出时回到原库位） */
  @Column({ type: 'varchar' })
  warehouseCode: string;

  @Column({ type: 'varchar' })
  originLocation: string;

  @Column({ type: 'varchar', default: SurplusStatus.OPEN })
  status: SurplusStatus;

  @Column({ type: 'varchar' })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
