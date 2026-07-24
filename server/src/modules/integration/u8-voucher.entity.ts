import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Mock U8 侧已接收的凭证（模拟用友 ERP 账务） */
@Entity('u8_voucher')
export class U8Voucher {
  @PrimaryGeneratedColumn()
  id: number;

  /** 凭证类型，如 RECEIVE / ISSUE / TRANSFER */
  @Column({ type: 'varchar' })
  voucherType: string;

  /** 业务键（幂等去重，防止重放产生重复 U8 单据） */
  @Column({ type: 'varchar', unique: true })
  bizKey: string;

  @Column({ type: 'text' })
  payload: string;

  @CreateDateColumn()
  createdAt: Date;
}
