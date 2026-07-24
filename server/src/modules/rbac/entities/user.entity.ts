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

  @ManyToMany(() => Role, (r) => r.users, { eager: true })
  @JoinTable({ name: 'rbac_user_role' })
  roles: Role[];

  @CreateDateColumn()
  createdAt: Date;
}
