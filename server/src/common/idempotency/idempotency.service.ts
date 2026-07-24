import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency.entity';
import { scopedBusinessKey } from './idempotency-context';

/**
 * 幂等服务：HTTP 拦截器与 InventoryService 共用。
 * execute() 内 fn 已执行但落库撞唯一约束时，说明并发重复 → 返回首个已存响应。
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
  ) {}

  async findStored<T>(requestId: string, businessKey: string): Promise<T | undefined> {
    const rec = await this.repo.findOne({
      where: { requestId, businessKey: scopedBusinessKey(businessKey) },
    });
    return rec ? (JSON.parse(rec.response) as T) : undefined;
  }

  async execute<T>(
    requestId: string,
    businessKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const stored = await this.findStored<T>(requestId, businessKey);
    if (stored !== undefined) return stored;

    const result = await fn();
    try {
      await this.repo.save(
        this.repo.create({
          requestId,
          businessKey: scopedBusinessKey(businessKey),
          response: JSON.stringify(result ?? null),
        }),
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        const existing = await this.findStored<T>(requestId, businessKey);
        if (existing !== undefined) return existing;
      }
      throw e;
    }
    return result;
  }
}
