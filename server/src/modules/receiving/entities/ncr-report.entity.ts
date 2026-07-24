import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 电子不合格报告（IQC 判定产生不合格/特采数量时自动生成，推送 IQC+MRB 成员角色） */
@Entity('rcv_ncr_report')
export class NcrReport {
  @PrimaryGeneratedColumn()
  id: number;

  /** 报告编号（编号器 NCR 前缀） */
  @Column({ type: 'varchar', unique: true })
  ncrNo: string;

  @Column({ type: 'varchar' })
  arrivalNo: string;

  @Column({ type: 'varchar' })
  batchNo: string;

  @Column({ type: 'varchar' })
  materialCode: string;

  /** 不合格数量（含特采） */
  @Column({ type: 'real' })
  qty: number;

  @Column({ type: 'text' })
  defectDescription: string;

  /** 推送对象角色（逗号分隔），默认 IQC+MRB 成员 */
  @Column({ type: 'varchar', default: 'IQC,MRB' })
  notifyRoles: string;

  /** OPEN / CLOSED */
  @Column({ type: 'varchar', default: 'OPEN' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
