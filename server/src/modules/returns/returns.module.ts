import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';
import { StockOccupation } from '../inventory/entities/stock-occupation.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { Material } from '../masterdata/entities/material.entity';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Bom } from '../masterdata/entities/bom.entity';
import { Location } from '../masterdata/entities/location.entity';
import { DefectRecord } from './entities/defect-record.entity';
import { ReturnOrder } from './entities/return-order.entity';
import { ReplenishOrder } from './entities/replenish-order.entity';
import { WriteoffOrder } from './entities/writeoff-order.entity';
import { QualityTransfer } from './entities/quality-transfer.entity';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';

export const RETURNS_ENTITIES = [
  DefectRecord,
  ReturnOrder,
  ReplenishOrder,
  WriteoffOrder,
  QualityTransfer,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...RETURNS_ENTITIES,
      StockOccupation,
      StockLot,
      Material,
      WorkOrder,
      Bom,
      Location,
    ]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
