import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MasterdataService } from './masterdata.service';
import { MasterdataController } from './masterdata.controller';
import { Material } from './entities/material.entity';
import { Supplier } from './entities/supplier.entity';
import { Customer } from './entities/customer.entity';
import { Warehouse } from './entities/warehouse.entity';
import { Location } from './entities/location.entity';
import { WorkOrder } from './entities/work-order.entity';
import { Bom } from './entities/bom.entity';
import { BomItem } from './entities/bom-item.entity';

export const MASTERDATA_ENTITIES = [
  Material,
  Supplier,
  Customer,
  Warehouse,
  Location,
  WorkOrder,
  Bom,
  BomItem,
];

@Module({
  imports: [TypeOrmModule.forFeature(MASTERDATA_ENTITIES)],
  controllers: [MasterdataController],
  providers: [MasterdataService],
  exports: [MasterdataService],
})
export class MasterdataModule {}
