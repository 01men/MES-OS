import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Bom } from '../masterdata/entities/bom.entity';
import { Location } from '../masterdata/entities/location.entity';
import { PrepTask } from './entities/prep-task.entity';
import { PrepTaskLine } from './entities/prep-task-line.entity';
import { PrepScanRecord } from './entities/prep-scan-record.entity';
import { PrepOrder } from './entities/prep-order.entity';
import { PrepOrderLine } from './entities/prep-order-line.entity';
import { ReversalDoc } from './entities/reversal-doc.entity';
import { KittingService } from './kitting.service';
import { PrepService } from './prep.service';
import { PrepController } from './prep.controller';

export const PREP_ENTITIES = [
  PrepTask,
  PrepTaskLine,
  PrepScanRecord,
  PrepOrder,
  PrepOrderLine,
  ReversalDoc,
];

@Module({
  imports: [
    TypeOrmModule.forFeature([...PREP_ENTITIES, StockLot, WorkOrder, Bom, Location]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [PrepController],
  providers: [KittingService, PrepService],
  exports: [KittingService, PrepService],
})
export class PrepModule {}
