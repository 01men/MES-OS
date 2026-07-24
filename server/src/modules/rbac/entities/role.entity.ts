import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DataScope } from '../../../common/enums';
import { Permission } from './permission.entity';
import { User } from './user.entity';

@Entity('rbac_role')
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  code: string;

  @Column({ type: 'varchar' })
  name: string;

  /** 数据范围：ALL / DEPT / SELF */
  @Column({ type: 'varchar', default: DataScope.ALL })
  dataScope: DataScope;

  @ManyToMany(() => Permission, { eager: true })
  @JoinTable({ name: 'rbac_role_permission' })
  permissions: Permission[];

  @ManyToMany(() => User, (u) => u.roles)
  users: User[];
}
