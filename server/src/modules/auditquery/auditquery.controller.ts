import { Controller, Get, Query, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { AuditLog } from '../../common/audit/audit.entity';
import { RequirePerm } from '../rbac/require-perm.decorator';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  if (!DATE_ONLY.test(value)) return new Date(value);
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
}

/**
 * 审计查询（阶段七）：只读 REST，不提供任何写接口。
 * 默认窗口近 7 天，按时间倒序，分页；export 导出带 BOM 的 CSV。
 */
@Controller('audit')
export class AuditQueryController {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  @Get('logs')
  @RequirePerm('audit.read')
  async logs(
    @Query('operator') operator?: string,
    @Query('action') action?: string,
    @Query('docNo') docNo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const s = Math.min(200, Math.max(1, Number(size) || 20));
    const qb = this.buildQuery({ operator, action, docNo, from, to });
    const [items, total] = await qb
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();
    return { total, page: p, size: s, items };
  }

  @Get('logs/export')
  @RequirePerm('audit.read')
  async export(
    @Res() res: Response,
    @Query('operator') operator?: string,
    @Query('action') action?: string,
    @Query('docNo') docNo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const rows = await this.buildQuery({ operator, action, docNo, from, to })
      .take(5000)
      .getMany();
    const header = 'id,operator,role,device,ip,action,docNo,result,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        r.operator,
        r.role ?? '',
        r.device ?? '',
        r.ip ?? '',
        r.action,
        r.docNo ?? '',
        r.result,
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    // 带 BOM，Excel 打开中文不乱码
    const csv = '\uFEFF' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="audit-logs.csv"',
    );
    res.send(csv);
  }

  private buildQuery(filter: {
    operator?: string;
    action?: string;
    docNo?: string;
    from?: string;
    to?: string;
  }) {
    const to = parseBoundary(filter.to, true) ?? new Date();
    const from =
      parseBoundary(filter.from, false) ??
      new Date(to.getTime() - 7 * DAY_MS);
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.createdAt >= :from', { from })
      .andWhere('a.createdAt <= :to', { to })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC');
    if (filter.operator) {
      qb.andWhere('a.operator = :operator', { operator: filter.operator });
    }
    if (filter.action) {
      qb.andWhere('a.action = :action', { action: filter.action });
    }
    if (filter.docNo) {
      qb.andWhere('a.docNo = :docNo', { docNo: filter.docNo });
    }
    return qb;
  }
}
