import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { BizException } from '../../common/exceptions';
import { Material } from './entities/material.entity';
import { Supplier } from './entities/supplier.entity';
import { Customer } from './entities/customer.entity';
import { Warehouse } from './entities/warehouse.entity';
import { Location } from './entities/location.entity';
import { WorkOrder } from './entities/work-order.entity';
import { Bom } from './entities/bom.entity';

const RESOURCES: Record<string, EntityTarget<ObjectLiteral>> = {
  materials: Material,
  suppliers: Supplier,
  customers: Customer,
  warehouses: Warehouse,
  locations: Location,
  'work-orders': WorkOrder,
  boms: Bom,
};

/** 主数据通用 CRUD（物料/供应商/客户/仓库/库位/工单/BOM） */
@Injectable()
export class MasterdataService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  repo(resource: string): Repository<ObjectLiteral> {
    const target = RESOURCES[resource];
    if (!target) {
      throw new BizException('RESOURCE_NOT_FOUND', `Unknown masterdata resource: ${resource}`, 404);
    }
    return this.ds.getRepository(target);
  }

  list(resource: string) {
    return this.repo(resource).find();
  }

  async get(resource: string, code: string) {
    const pk = this.pkOf(resource);
    const row = await this.repo(resource).findOne({ where: { [pk]: code } as any });
    if (!row) {
      throw new BizException('NOT_FOUND', `${resource}/${code} not found`, 404);
    }
    return row;
  }

  async create(resource: string, body: any) {
    const pk = this.pkOf(resource);
    if (!body?.[pk]) {
      throw new BizException('PK_REQUIRED', `Missing primary key field: ${pk}`);
    }
    return this.repo(resource).save(body);
  }

  async update(resource: string, code: string, body: any) {
    await this.get(resource, code);
    const pk = this.pkOf(resource);
    delete body[pk];
    return this.repo(resource).save({ ...body, [pk]: code });
  }

  async remove(resource: string, code: string) {
    const row = await this.get(resource, code);
    await this.repo(resource).remove(row);
    return { removed: code };
  }

  private pkOf(resource: string): string {
    const meta = this.repo(resource).metadata;
    return meta.primaryColumns[0].propertyName;
  }
}
