import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StocktakeService } from './stocktake.service';
import { StocktakeController } from './stocktake.controller';
import { StocktakeStrategy } from './entities/stocktake-strategy.entity';
import { StocktakeTask } from './entities/stocktake-task.entity';
import { StocktakeSnapshot } from './entities/stocktake-snapshot.entity';
import { StocktakeFrozenMovement } from './entities/stocktake-frozen-movement.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { StockMovement } from '../inventory/entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';
import { Location } from '../masterdata/entities/location.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { IntegrationModule } from '../integration/integration.module';

export const STOCKTAKE_ENTITIES = [
  StocktakeStrategy,
  StocktakeTask,
  StocktakeSnapshot,
  StocktakeFrozenMovement,
];

/**
 * 盘点链模块（stocktake）：循环盘点策略、PDA 盲盘/复盘、年度冻结、差异审批过账、库龄预警。
 * 依赖契约（只调用不修改）：InventoryService / SyncService / ApprovalEngineService /
 * NumberingService / IdempotencyService / AuditService / RuleConfigService。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([...STOCKTAKE_ENTITIES, StockLot, StockMovement, Material, Location]),
    InventoryModule,
    IntegrationModule,
  ],
  controllers: [StocktakeController],
  providers: [StocktakeService],
  exports: [StocktakeService],
})
export class StocktakeModule {}
