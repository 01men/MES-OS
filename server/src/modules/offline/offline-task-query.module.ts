import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OfflineTask } from './offline-task.entity';
import { OfflineTaskQueryController } from './offline-task-query.controller';

/**
 * 离线任务查询/冲突处理模块（阶段七新增）。
 * 文件名按字典序排在 offline.module.ts 之前，保证自动发现时本模块先注册，
 * GET /api/offline/tasks 走带过滤的新实现。
 */
@Module({
  imports: [TypeOrmModule.forFeature([OfflineTask])],
  controllers: [OfflineTaskQueryController],
})
export class OfflineTaskQueryModule {}
