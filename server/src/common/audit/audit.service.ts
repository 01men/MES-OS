import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit.entity';

export interface AuditEntry {
  operator: string;
  role?: string;
  device?: string;
  ip?: string;
  action: string;
  docNo?: string;
  before?: unknown;
  after?: unknown;
  result: string;
}

/**
 * 审计服务：append-only。AuditLog 实体无更新/删除 API（请勿添加）。
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(entry: AuditEntry): Promise<AuditLog> {
    const rec = this.repo.create({
      operator: entry.operator,
      role: entry.role ?? null,
      device: entry.device ?? null,
      ip: entry.ip ?? null,
      action: entry.action,
      docNo: entry.docNo ?? null,
      before: entry.before !== undefined ? JSON.stringify(entry.before) : null,
      after: entry.after !== undefined ? JSON.stringify(entry.after) : null,
      result: entry.result,
    });
    return this.repo.save(rec);
  }

  async query(filter: { docNo?: string; operator?: string; action?: string }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.id', 'DESC');
    if (filter.docNo) qb.andWhere('a.docNo = :docNo', filter);
    if (filter.operator) qb.andWhere('a.operator = :operator', filter);
    if (filter.action) qb.andWhere('a.action = :action', filter);
    return qb.getMany();
  }
}
