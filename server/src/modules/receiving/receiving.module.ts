import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';
import {
  RcvPurchaseOrder,
  RcvPurchaseOrderLine,
} from './entities/purchase-order.entity';
import { ReceivingArrival } from './entities/receiving-arrival.entity';
import { LabelPrintLog } from './entities/label-print-log.entity';
import { NcrReport } from './entities/ncr-report.entity';
import { Material } from '../masterdata/entities/material.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';

export const RECEIVING_ENTITIES = [
  RcvPurchaseOrder,
  RcvPurchaseOrderLine,
  ReceivingArrival,
  LabelPrintLog,
  NcrReport,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([...RECEIVING_ENTITIES, Material]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [ReceivingController],
  providers: [ReceivingService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
