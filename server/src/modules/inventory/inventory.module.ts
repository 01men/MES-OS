import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { StockLot } from './entities/stock-lot.entity';
import { StockOccupation } from './entities/stock-occupation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';
import { Location } from '../masterdata/entities/location.entity';

export const INVENTORY_ENTITIES = [StockLot, StockOccupation, StockMovement];

@Module({
  imports: [TypeOrmModule.forFeature([...INVENTORY_ENTITIES, Material, Location])],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
