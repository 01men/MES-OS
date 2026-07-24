import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { TraceService } from './trace.service';
import { CommonUploadController } from './upload.controller';
import { DeliveryNote } from './entities/delivery-note.entity';
import { DeliveryNoteLine } from './entities/delivery-note-line.entity';
import { SerialNumber } from './entities/serial-number.entity';
import { ScanRecord } from './entities/scan-record.entity';
import { Shortage } from './entities/shortage.entity';
import { ShippingPhoto } from './entities/photo.entity';
import { ReversalDoc } from './entities/reversal-doc.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Customer } from '../masterdata/entities/customer.entity';
import { Supplier } from '../masterdata/entities/supplier.entity';
import { Bom } from '../masterdata/entities/bom.entity';
import { IntegrationModule } from '../integration/integration.module';

export const SHIPPING_ENTITIES = [
  DeliveryNote,
  DeliveryNoteLine,
  SerialNumber,
  ScanRecord,
  Shortage,
  ShippingPhoto,
  ReversalDoc,
];

/**
 * 发运追溯链模块（REQ-022/023/025/026 + 纪要装柜顺序 + 通用上传）。
 * 公共机制（编号/幂等/审计/审批/规则配置）由 Global 模块注入；U8 集成依赖 IntegrationModule。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...SHIPPING_ENTITIES,
      StockLot,
      WorkOrder,
      Customer,
      Supplier,
      Bom,
    ]),
    IntegrationModule,
  ],
  controllers: [ShippingController, CommonUploadController],
  providers: [ShippingService, TraceService],
  exports: [ShippingService, TraceService],
})
export class ShippingModule {}
