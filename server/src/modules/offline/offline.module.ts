import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OfflineTask } from './offline-task.entity';
import { OfflineController } from './offline.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OfflineTask])],
  controllers: [OfflineController],
})
export class OfflineModule {}
