import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RuleConfig } from './rule-config.entity';

@Injectable()
export class RuleConfigService {
  constructor(
    @InjectRepository(RuleConfig)
    private readonly repo: Repository<RuleConfig>,
  ) {}

  /** 取当前生效（最新版本且已生效）的配置值 */
  async get(key: string): Promise<string | undefined> {
    const row = await this.repo
      .createQueryBuilder('r')
      .where('r.key = :key', { key })
      .andWhere('r.effectiveAt <= :now', { now: new Date() })
      .orderBy('r.version', 'DESC')
      .getOne();
    return row?.value;
  }

  /** 追加新版本（不覆盖旧版本），返回新记录 */
  async set(key: string, value: string, operator?: string): Promise<RuleConfig> {
    const latest = await this.repo.findOne({
      where: { key },
      order: { version: 'DESC' },
    });
    const version = (latest?.version ?? 0) + 1;
    return this.repo.save(
      this.repo.create({ key, value, version, effectiveAt: new Date(), operator }),
    );
  }

  /** 查看某 key 的全部版本 */
  history(key: string) {
    return this.repo.find({ where: { key }, order: { version: 'DESC' } });
  }

  /** 全部 key 的当前生效值（每 key 取已生效的最高版本） */
  async listCurrent(): Promise<RuleConfig[]> {
    const rows = await this.repo.find({ order: { id: 'ASC' } });
    const now = new Date();
    const current = new Map<string, RuleConfig>();
    for (const r of rows) {
      if (new Date(r.effectiveAt) > now) continue;
      const cur = current.get(r.key);
      if (!cur || r.version > cur.version) current.set(r.key, r);
    }
    return [...current.values()];
  }
}
