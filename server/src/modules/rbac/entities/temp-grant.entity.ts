import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 临时授权：到期自动失效（PermissionGuard 校验 expiresAt > now） */
@Entity('rbac_temp_grant')
export class TempGrant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  userId: number;

  @Column({ type: 'varchar' })
  permissionCode: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'varchar', nullable: true })
  grantedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
