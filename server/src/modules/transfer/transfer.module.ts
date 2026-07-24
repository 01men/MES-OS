import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { StockOccupation } from '../inventory/entities/stock-occupation.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { StockMovement } from '../inventory/entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';
import { TransferOrder } from './entities/transfer-order.entity';
import { ReplenishTodo } from './entities/replenish-todo.entity';
import { ReworkOrder } from './entities/rework-order.entity';
import { TransferService } from './transfer.service';
import { TransferController } from './transfer.controller';

export const TRANSFER_ENTITIES = [TransferOrder, ReplenishTodo, ReworkOrder];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...TRANSFER_ENTITIES,
      StockOccupation,
      StockLot,
      StockMovement,
      Material,
    ]),
    InventoryModule,
  ],
  controllers: [TransferController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
