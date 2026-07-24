import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AbcClass } from '../../../common/enums';

@Entity('md_material')
export class Material {
  @PrimaryColumn({ type: 'varchar' })
  materialCode: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', default: AbcClass.UNSET })
  abcClass: AbcClass;

  /** 安全库存（available 公式中扣减） */
  @Column({ type: 'real', default: 0 })
  safetyStock: number;

  @Column({ type: 'varchar', default: 'PCS' })
  unit: string;

  /** 保质天数，空表示不管控效期 */
  @Column({ type: 'integer', nullable: true })
  shelfLifeDays: number;

  /** 专用件标记：默认待确认(false=未确认) */
  @Column({ type: 'boolean', default: false })
  isSpecial: boolean;

  /** 专用件确认状态：PENDING/CONFIRMED/NORMAL */
  @Column({ type: 'varchar', default: 'PENDING' })
  specialStatus: string;
}
