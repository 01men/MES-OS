import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 出库照片留证（REQ-023）。
 * 类型：CAR 车牌 / SEAL 签封 / EMPTY 空柜 / SIDE1|SIDE2 每托两侧 / MARK 唛头。
 * 文件命名：发货单号_类型_毫秒时间戳.jpg；fileName 唯一约束保证重传不重复。
 */
@Entity('shp_photo')
export class ShippingPhoto {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer' })
  noteId: number;

  @Column({ type: 'varchar' })
  photoType: string;

  @Column({ type: 'varchar', unique: true })
  fileName: string;

  @Column({ type: 'varchar' })
  url: string;

  @Column({ type: 'integer' })
  size: number;

  /** PENDING 待传/校验失败 | CONFIRMED 校验通过 */
  @Column({ type: 'varchar', default: 'PENDING' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  failReason: string;

  @Column({ type: 'varchar' })
  uploadedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
