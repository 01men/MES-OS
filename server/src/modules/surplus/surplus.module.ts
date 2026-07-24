import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { Material } from '../masterdata/entities/material.entity';
import { Location } from '../masterdata/entities/location.entity';
import { SurplusRecord } from './entities/surplus-record.entity';
import { SurplusReminder } from './entities/surplus-reminder.entity';
import { SurplusProcess } from './entities/surplus-process.entity';
import { SurplusPrintLog } from './entities/surplus-print-log.entity';
import { SurplusService } from './surplus.service';
import { SurplusController } from './surplus.controller';

export const SURPLUS_ENTITIES = [
  SurplusRecord,
  SurplusReminder,
  SurplusProcess,
  SurplusPrintLog,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([...SURPLUS_ENTITIES, StockLot, Material, Location]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [SurplusController],
  providers: [SurplusService],
  exports: [SurplusService],
})
export class SurplusModule {}
