import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NumberingSequence } from './numbering.entity';

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 单据编号服务：next('RCV') → 'RCV20260724-0001'。
 * 规则：类型码 + yyyyMMdd + '-' + 4 位流水，按日重置；
 * 事务内读改写 + (typeCode,dateStr) 唯一约束冲突重试，保证并发不重号；
 * 流水只增不减，作废号不复用。
 */
@Injectable()
export class NumberingService {
  /**
   * 进程内串行队列：sqljs 为单连接驱动，不支持并发事务
   * （"cannot start a transaction within a transaction"），
   * 取号在本进程内串行化；唯一约束重试作为多写者兜底。
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async next(typeCode: string, date: Date = new Date()): Promise<string> {
    const run = this.queue.then(() => this.nextInternal(typeCode, date));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async nextInternal(typeCode: string, date: Date): Promise<string> {
    const dateStr = fmtDate(date);
    const maxRetry = 5;
    for (let attempt = 0; attempt < maxRetry; attempt++) {
      try {
        const seq = await this.ds.transaction(async (em) => {
          const repo = em.getRepository(NumberingSequence);
          let row = await repo.findOne({ where: { typeCode, dateStr } });
          if (!row) {
            row = repo.create({ typeCode, dateStr, lastSeq: 0 });
          }
          row.lastSeq += 1;
          await repo.save(row);
          return row.lastSeq;
        });
        return `${typeCode}${dateStr}-${String(seq).padStart(4, '0')}`;
      } catch (e: any) {
        // 并发插入同一 (typeCode,dateStr) 触发唯一约束 → 重试走 update 分支
        const msg = String(e?.message ?? e);
        if (
          attempt < maxRetry - 1 &&
          (msg.includes('UNIQUE') || msg.includes('unique'))
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new Error('unreachable');
  }
}
