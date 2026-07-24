import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from '../masterdata/entities/material.entity';
import { RcvPurchaseOrder, RcvPurchaseOrderLine } from '../receiving/entities/purchase-order.entity';
import { ReceivingArrival } from '../receiving/entities/receiving-arrival.entity';
import { DeliveryNote } from '../shipping/entities/delivery-note.entity';
import { DeliveryNoteLine } from '../shipping/entities/delivery-note-line.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';
import { OpenApiController } from './openapi.controller';
import { OpenApiKeyGuard } from './open-api-key.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Material,
      RcvPurchaseOrder,
      RcvPurchaseOrderLine,
      ReceivingArrival,
      DeliveryNote,
      DeliveryNoteLine,
    ]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [OpenApiController],
  providers: [OpenApiKeyGuard],
})
export class OpenapiModule {}
