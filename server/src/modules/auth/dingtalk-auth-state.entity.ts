import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DingTalkAuthMode = 'login' | 'bind';

/**
 * 钉钉 OAuth state：一次性、短时有效，防止 CSRF 与回调重放。
 * 生产迁移到多实例时可替换为 Redis，但契约保持不变。
 */
@Entity('auth_dingtalk_state')
export class DingTalkAuthState {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  token: string;

  @Column({ type: 'varchar' })
  mode: DingTalkAuthMode;

  @Column({ type: 'integer', nullable: true })
  userId: number | null;

  @Column({ type: 'varchar' })
  publicOrigin: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
