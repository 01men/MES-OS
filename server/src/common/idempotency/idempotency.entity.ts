import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** 幂等记录：同一 (requestId, businessKey) 只执行一次，重复请求返回首个响应 */
@Entity('idempotency_record')
@Unique(['requestId', 'businessKey'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** 请求头 X-Request-Id */
  @Column({ type: 'varchar' })
  requestId: string;

  /** 业务键，如 inventory.inbound / POST /api/offline/sync */
  @Column({ type: 'varchar' })
  businessKey: string;

  /** 首个响应的 JSON 串 */
  @Column({ type: 'text' })
  response: string;

  @CreateDateColumn()
  createdAt: Date;
}
