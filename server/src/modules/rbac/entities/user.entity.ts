import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from './role.entity';

@Entity('rbac_user')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  username: string;

  @Column({ type: 'varchar' })
  passwordHash: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'boolean', default: false })
  disabled: boolean;

  /** 钉钉 OAuth 身份；只允许绑定到一个本地 MES 用户。 */
  @Column({ type: 'varchar', nullable: true, unique: true })
  dingtalkUnionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  dingtalkOpenId: string | null;

  @Column({ type: 'varchar', nullable: true })
  dingtalkNick: string | null;

  @Column({ type: 'varchar', nullable: true })
  dingtalkAvatarUrl: string | null;

  @Column({ type: 'datetime', nullable: true })
  dingtalkBoundAt: Date | null;

  @ManyToMany(() => Role, (r) => r.users, { eager: true })
  @JoinTable({ name: 'rbac_user_role' })
  roles: Role[];

  @CreateDateColumn()
  createdAt: Date;
}
