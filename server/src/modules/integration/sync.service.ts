import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncTask } from './sync-task.entity';
import { U8Voucher } from './u8-voucher.entity';
import { U8Adapter } from './u8-adapter';
import { DocStatus } from '../../common/enums';
import { DocStatusMachine } from '../../common/doc-status.machine';
import { BizException } from '../../common/exceptions';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnqueueInput {
  bizType: string;
  bizKey: string;
  voucherType: string;
  payload: unknown;
}

/**
 * U8 同步服务：
 *  - enqueue：建任务(PENDING_SYNC)并处理（MVP 同步执行，保证可测试性；生产可改异步队列）；
 *  - 失败自动重试 3 次（指数退避，间隔可配置 retryDelaysMs），仍失败 → SYNC_ERROR + 告警；
 *  - replay：人工重放，幂等（已 SYNCED 直接返回，不产生重复 U8 单据）；
 *  - reconcile：日终对账，返回 MES 已同步 vs U8Voucher 差异清单。
 */
@Injectable()
export class SyncService {
  /** 指数退避间隔（毫秒），测试可覆写为小值 */
  retryDelaysMs = [1000, 2000, 4000];
  maxAttempts = 3;

  constructor(
    @InjectRepository(SyncTask)
    private readonly taskRepo: Repository<SyncTask>,
    @InjectRepository(U8Voucher)
    private readonly voucherRepo: Repository<U8Voucher>,
    private readonly adapter: U8Adapter,
  ) {}

  async enqueue(input: EnqueueInput): Promise<SyncTask> {
    const existing = await this.taskRepo.findOne({ where: { bizKey: input.bizKey } });
    if (existing) return this.process(existing.id);
    const task = await this.taskRepo.save(
      this.taskRepo.create({
        bizType: input.bizType,
        bizKey: input.bizKey,
        voucherType: input.voucherType,
        payload: JSON.stringify(input.payload ?? {}),
        status: DocStatus.PENDING_SYNC,
        attempts: 0,
      }),
    );
    return this.process(task.id);
  }

  /** 执行推送：成功 → SYNCED；失败重试 maxAttempts 次 → SYNC_ERROR + 告警 */
  async process(taskId: number): Promise<SyncTask> {
    let task = await this.mustGet(taskId);
    if (task.status === DocStatus.SYNCED) return task; // 幂等

    while (task.attempts < this.maxAttempts) {
      try {
        await this.adapter.pushVoucher(task.voucherType, JSON.parse(task.payload), task.bizKey);
        task.status = DocStatusMachine.transition(task.status, DocStatus.SYNCED);
        task.lastError = null;
        task.alarm = null;
        return this.taskRepo.save(task);
      } catch (e: any) {
        task.attempts += 1;
        task.lastError = String(e?.message ?? e);
        await this.taskRepo.save(task);
        if (task.attempts < this.maxAttempts) {
          await sleep(this.retryDelaysMs[task.attempts - 1] ?? 4000);
        }
      }
    }
    // 重试耗尽 → SYNC_ERROR + 告警
    task.status = DocStatusMachine.transition(task.status, DocStatus.SYNC_ERROR);
    task.alarm = `U8 sync failed after ${task.attempts} attempts: ${task.lastError}`;
    return this.taskRepo.save(task);
  }

  /** 人工重放：幂等。SYNC_ERROR → PENDING_SYNC → 重新推送 */
  async replay(taskId: number): Promise<{ task: SyncTask; replayed: boolean }> {
    let task = await this.mustGet(taskId);
    if (task.status === DocStatus.SYNCED) {
      return { task, replayed: false }; // 已同步：直接返回，不产生重复 U8 单据
    }
    if (task.status !== DocStatus.SYNC_ERROR && task.status !== DocStatus.PENDING_SYNC) {
      throw new BizException('REPLAY_NOT_ALLOWED', `Task in status ${task.status} cannot be replayed`);
    }
    if (task.status === DocStatus.SYNC_ERROR) {
      task.status = DocStatusMachine.transition(task.status, DocStatus.PENDING_SYNC);
      task.attempts = 0;
      task.alarm = null;
      task = await this.taskRepo.save(task);
    }
    return { task: await this.process(task.id), replayed: true };
  }

  logs() {
    return this.taskRepo.find({ order: { id: 'DESC' } });
  }

  /** 日终对账：MES 已同步 vs U8Voucher 差异清单 */
  async reconcile() {
    const synced = await this.taskRepo.find({ where: { status: DocStatus.SYNCED } });
    const vouchers = await this.voucherRepo.find();
    const mesKeys = new Set(synced.map((t) => t.bizKey));
    const u8Keys = new Set(vouchers.map((v) => v.bizKey));
    return {
      mesSyncedCount: mesKeys.size,
      u8VoucherCount: u8Keys.size,
      inMesNotU8: [...mesKeys].filter((k) => !u8Keys.has(k)),
      inU8NotMes: [...u8Keys].filter((k) => !mesKeys.has(k)),
    };
  }

  private async mustGet(id: number): Promise<SyncTask> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new BizException('SYNC_TASK_NOT_FOUND', `Sync task ${id} not found`, 404);
    return task;
  }
}
