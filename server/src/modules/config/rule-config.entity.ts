import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * 业务规则配置：版本化存储，新版本追加而非覆盖旧版本。
 * 单据编号规则、U8 故障开关(u8.mockFailure)等均存于此。
 */
@Entity('rule_config')
@Unique(['key', 'version'])
export class RuleConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'datetime' })
  effectiveAt: Date;

  @Column({ type: 'varchar', nullable: true })
  operator: string;

  @CreateDateColumn()
  createdAt: Date;
}
