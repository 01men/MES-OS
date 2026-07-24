import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PermissionType } from '../../../common/enums';

@Entity('rbac_permission')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  /** 权限码，如 masterdata.material.create；'*' 为超级权限 */
  @Column({ type: 'varchar', unique: true })
  code: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', default: PermissionType.BUTTON })
  type: PermissionType;
}
