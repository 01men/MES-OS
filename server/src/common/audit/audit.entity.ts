import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 审计日志：只增不改，不提供更新/删除 API */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  operator: string;

  @Column({ type: 'varchar', nullable: true })
  role: string;

  @Column({ type: 'varchar', nullable: true })
  device: string;

  @Column({ type: 'varchar', nullable: true })
  ip: string;

  /** 动作，如 inventory.inbound / doc.approve */
  @Column({ type: 'varchar' })
  action: string;

  @Column({ type: 'varchar', nullable: true })
  docNo: string;

  /** 变更前快照 JSON */
  @Column({ type: 'text', nullable: true })
  before: string;

  /** 变更后快照 JSON */
  @Column({ type: 'text', nullable: true })
  after: string;

  /** SUCCESS / FAIL:原因 */
  @Column({ type: 'varchar' })
  result: string;

  @CreateDateColumn()
  createdAt: Date;
}
