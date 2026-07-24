import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfflineTask } from './offline-task.entity';
import { OfflineStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { AuditService } from '../../common/audit/audit.service';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { RequirePerm } from '../rbac/require-perm.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/current-user.decorator';

/**
 * 离线任务查询与冲突处理（阶段七骨架）。
 * 注意：本文件按规则为新增文件；文件名须排在 offline.module.ts 之前被自动发现，
 * 使 GET /offline/tasks 由本控制器（带 status 过滤 + 当前用户范围）优先匹配。
 */
@Controller('offline')
export class OfflineTaskQueryController {
  constructor(
    @InjectRepository(OfflineTask)
    private readonly repo: Repository<OfflineTask>,
    private readonly audit: AuditService,
  ) {}

  /** 当前用户（可选设备）的任务列表，按状态过滤 */
  @Get('tasks')
  @RequirePerm('offline.sync')
  tasks(
    @CurrentUser('username') username: string,
    @Query('status') status?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.repo.find({
      where: {
        operatorId: username,
        ...(status ? { status: status as OfflineStatus } : {}),
        ...(deviceId ? { deviceId } : {}),
      },
      order: { id: 'DESC' },
    });
  }

  /**
   * 冲突处理骨架：KEEP_LOCAL 保留本地数据待重新同步；USE_SERVER 以服务端为准废弃本地任务。
   * 仅更新状态 + 审计，真实业务回放由后续迭代实现。
   */
  @Post('tasks/:id/resolve')
  @RequirePerm('offline.sync')
  @Idempotent('offline.resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: { choice?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const task = await this.repo.findOne({ where: { id: Number(id) } });
    if (!task) {
      throw new BizException('OFFLINE_TASK_NOT_FOUND', `Offline task ${id} not found`);
    }
    if (task.status !== OfflineStatus.CONFLICT) {
      throw new BizException(
        'OFFLINE_TASK_NOT_CONFLICT',
        `Task ${task.taskNo} is ${task.status}, only CONFLICT can be resolved`,
      );
    }
    const choice = body?.choice;
    if (choice !== 'KEEP_LOCAL' && choice !== 'USE_SERVER') {
      throw new BizException(
        'OFFLINE_RESOLVE_CHOICE_INVALID',
        "choice must be 'KEEP_LOCAL' or 'USE_SERVER'",
      );
    }
    if (choice === 'KEEP_LOCAL') {
      task.status = OfflineStatus.PENDING;
      task.message = '冲突已处理：保留本地数据，待重新同步';
    } else {
      task.status = OfflineStatus.FAILED;
      task.message = '冲突已处理：以服务端为准，本地任务废弃';
    }
    await this.repo.save(task);
    await this.audit.log({
      operator: user.username,
      role: user.roles.join(','),
      device: task.deviceId,
      action: 'offline.resolve',
      docNo: task.taskNo,
      after: { choice, status: task.status },
      result: 'SUCCESS',
    });
    return task;
  }
}
