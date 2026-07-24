import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 到货暂存单状态链：ARRIVED → INSPECTING → INSPECTED → CONFIRMED */
export enum ArrivalStatus {
  ARRIVED = 'ARRIVED', // 到货暂存（未入库）
  INSPECTING = 'INSPECTING', // 已送检
  INSPECTED = 'INSPECTED', // IQC 已判定
  CONFIRMED = 'CONFIRMED', // 已确认入库/隔离
}

/** ABC 清点方式 */
export enum CountMode {
  FULL = 'FULL', // 全点（A 类与 UNSET 待分类）
  SAMPLE = 'SAMPLE', // 按比例抽查（B 类）
  LABEL = 'LABEL', // 按标签计数（C 类）
  MANUAL_REVIEW = 'MANUAL_REVIEW', // 超容差转人工复核
}

/** IQC 判定 */
export enum IqcDecision {
  ALL = 'ALL', // 全部接收
  PARTIAL = 'PARTIAL', // 部分接收
  CONCESSION = 'CONCESSION', // 特采
}

/** 入库过账记录（台账：特采/委外打标） */
export interface InboundPosting {
  packageNo: string;
  qty: number;
  status: 'QUALIFIED' | 'ISOLATED';
  /** 特采批次打标 */
  concession: boolean;
  /** 委外批次属性 */
  isOutsource: boolean;
  sourcePoNo: string;
  supplierCode: string;
}

/** 到货暂存单（三步前置链第一步：到货暂存 → 送检 → IQC → 入库/隔离） */
@Entity('rcv_arrival')
export class ReceivingArrival {
  @PrimaryGeneratedColumn()
  id: number;

  /** 收料单号（编号器 RCV 前缀） */
  @Column({ type: 'varchar', unique: true })
  arrivalNo: string;

  @Column({ type: 'varchar' })
  poNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 到货数量（最小包装单位） */
  @Column({ type: 'real' })
  qty: number;

  /** 实际扫码数量 */
  @Column({ type: 'real', default: 0 })
  scannedQty: number;

  /** 标签计数数量（C 类），可空 */
  @Column({ type: 'real', nullable: true })
  labelQty: number;

  /** 订单行数量快照（ABC 全点基准） */
  @Column({ type: 'real' })
  orderQty: number;

  @Column({ type: 'varchar' })
  supplierCode: string;

  /** 批次号：默认 LOT-YYYYMMDD-供应商编码-四位流水（RuleConfig receiving.batchRule 可配） */
  @Column({ type: 'varchar' })
  batchNo: string;

  /** 条码解析出的批次时间，可空 */
  @Column({ type: 'varchar', nullable: true })
  batchTime: string;

  /** 最小包装唯一号（编号器 PKG 前缀） */
  @Column({ type: 'varchar', unique: true })
  packageNo: string;

  @Column({ type: 'varchar' })
  warehouseCode: string;

  @Column({ type: 'varchar' })
  locationCode: string;

  /** 物料 ABC 分类快照 */
  @Column({ type: 'varchar' })
  abcClass: string;

  /** 清点方式（CountMode） */
  @Column({ type: 'varchar' })
  countMode: string;

  @Column({ type: 'varchar', default: ArrivalStatus.ARRIVED })
  status: ArrivalStatus;

  /** IQC 判定（IqcDecision），未判定为空 */
  @Column({ type: 'varchar', nullable: true })
  iqcDecision: IqcDecision;

  /** 数量守恒：qty = qualified + rejected + concession + pending */
  @Column({ type: 'real', nullable: true })
  qualifiedQty: number;

  @Column({ type: 'real', nullable: true })
  rejectedQty: number;

  @Column({ type: 'real', nullable: true })
  concessionQty: number;

  @Column({ type: 'real', nullable: true })
  pendingQty: number;

  @Column({ type: 'text', nullable: true })
  defectDescription: string;

  /** 特采 MRB 会签审批单 ID（Approval.id），可空 */
  @Column({ type: 'integer', nullable: true })
  approvalId: number;

  /** 委外标识（依据来源单据 purchaseOrder.orderType='OUTSOURCE'） */
  @Column({ type: 'boolean', default: false })
  isOutsource: boolean;

  /** 已分配工单（委外入库后触发工序发料提醒），可空 */
  @Column({ type: 'varchar', nullable: true })
  workOrderId: string;

  /** InboundPosting[] JSON（确认入库后写入） */
  @Column({ type: 'text', nullable: true })
  postings: string;

  /** 标签打印次数（首次=1，补打累加） */
  @Column({ type: 'integer', default: 1 })
  printCount: number;

  /** U8 同步状态（PENDING_SYNC/SYNCED/SYNC_ERROR），未同步为空 */
  @Column({ type: 'varchar', nullable: true })
  syncStatus: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
