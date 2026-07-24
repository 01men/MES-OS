import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 钉钉登录配置。AppSecret 仅以 AES-256-GCM 密文保存。 */
@Entity('auth_dingtalk_config')
export class DingTalkConfig {
  @PrimaryColumn({ type: 'integer', default: 1 })
  id: number;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', nullable: true })
  clientId: string | null;

  @Column({ type: 'text', nullable: true })
  clientSecretEncrypted: string | null;

  @Column({ type: 'varchar', nullable: true })
  publicOrigin: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
