import { Body, Controller, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OfflineTask } from './offline-task.entity';
import { OfflineStatus } from '../../common/enums';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { RequirePerm } from '../rbac/require-perm.decorator';

/**
 * 离线同步骨架：POST /api/offline/sync 幂等入口（@Idempotent + X-Request-Id）。
 * MVP 仅登记任务为待同步，具体业务回放由后续迭代实现。
 */
@Controller('offline')
export class OfflineController {
  constructor(
    @InjectRepository(OfflineTask)
    private readonly repo: Repository<OfflineTask>,
  ) {}

  @Post('sync')
  @Idempotent('offline.sync')
  @RequirePerm('offline.sync')
  async sync(
    @Body()
    body: {
      deviceId: string;
      operatorId: string;
      tasks: { taskNo: string; bizTime: string; payload: any }[];
    },
  ) {
    const accepted: string[] = [];
    const duplicated: string[] = [];
    for (const t of body.tasks ?? []) {
      const exists = await this.repo.findOne({ where: { taskNo: t.taskNo } });
      if (exists) {
        duplicated.push(t.taskNo);
        continue;
      }
      await this.repo.save(
        this.repo.create({
          deviceId: body.deviceId,
          operatorId: body.operatorId,
          taskNo: t.taskNo,
          bizTime: new Date(t.bizTime),
          payload: JSON.stringify(t.payload ?? {}),
          status: OfflineStatus.PENDING,
        }),
      );
      accepted.push(t.taskNo);
    }
    return { accepted, duplicated };
  }

}
