import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BizException } from '../../common/exceptions';
import { NumberingService } from '../../common/numbering/numbering.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { ApprovalStatus, StockStatus } from '../../common/enums';
import { RuleConfigService } from '../config/rule-config.service';
import { InventoryService } from '../inventory/inventory.service';
import { SyncService } from '../integration/sync.service';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { StockMovement } from '../inventory/entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';
import { Location } from '../masterdata/entities/location.entity';
import {
  StocktakeStrategy,
  StocktakeScopeType,
} from './entities/stocktake-strategy.entity';
import {
  StocktakeTask,
  StocktakeTaskStatus,
  StocktakeTaskType,
  FreezeMode,
} from './entities/stocktake-task.entity';
import {
  StocktakeSnapshot,
  SnapshotLineStatus,
} from './entities/stocktake-snapshot.entity';
import { StocktakeFrozenMovement } from './entities/stocktake-frozen-movement.entity';

/** 当前用户上下文（与 auth CurrentUserPayload 对齐的最小子集） */
export interface ActorContext {
  username: string;
  roles: string[];
}

interface DiffThreshold {
  qty: number;
  ratio: number;
}

const DAY_MS = 24 * 3600 * 1000;
/** 库龄预警：连续 3 个月（90 天）无出入库 */
const AGING_WARN_DAYS = 90;

const DEFAULT_DIFF_THRESHOLD: Record<string, DiffThreshold> = {
  A: { qty: 1, ratio: 0.01 },
  B: { qty: 5, ratio: 0.02 },
  C: { qty: 10, ratio: 0.05 },
  default: { qty: 10, ratio: 0.05 },
};

const DEFAULT_REINSPECT_DAYS: Record<string, number> = {
  五金: 180,
  塑料: 365,
  default: 270,
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 盘点链服务（REQ-018 循环盘点 / REQ-019 PDA 盘点 / REQ-020 年度冻结 + 库龄预警）。
 *
 * 账面口径：账面 = 快照 + 冻结后合法变动（软冻结隔离记录）+ 调整量。
 * 盲盘：blind 任务对非 WH_MANAGER/ADMIN 用户隐藏账面数与差异。
 */
@Injectable()
export class StocktakeService {
  constructor(
    @InjectRepository(StocktakeStrategy)
    private readonly strategyRepo: Repository<StocktakeStrategy>,
    @InjectRepository(StocktakeTask)
    private readonly taskRepo: Repository<StocktakeTask>,
    @InjectRepository(StocktakeSnapshot)
    private readonly snapRepo: Repository<StocktakeSnapshot>,
    @InjectRepository(StocktakeFrozenMovement)
    private readonly fmRepo: Repository<StocktakeFrozenMovement>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(StockMovement)
    private readonly movRepo: Repository<StockMovement>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly inv: InventoryService,
    private readonly sync: SyncService,
    private readonly numbering: NumberingService,
    private readonly idem: IdempotencyService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalEngineService,
    private readonly ruleConfig: RuleConfigService,
  ) {}

  // ---------- 策略 CRUD（REQ-018） ----------

  listStrategies() {
    return this.strategyRepo.find({ order: { id: 'ASC' } });
  }

  async createStrategy(
    body: Partial<StocktakeStrategy>,
    operator: string,
    requestId: string,
  ) {
    return this.idem.execute(requestId, 'stocktake.strategy.create', async () => {
      if (!body?.name || !body.scopeType || !body.scopeValue || !body.cycleDays || !body.ownerUserId) {
        throw new BizException(
          'STRATEGY_FIELDS_REQUIRED',
          'name/scopeType/scopeValue/cycleDays/ownerUserId are required',
        );
      }
      if (!Object.values(StocktakeScopeType).includes(body.scopeType)) {
        throw new BizException('SCOPE_TYPE_INVALID', `Unknown scopeType: ${body.scopeType}`);
      }
      const saved = await this.strategyRepo.save(
        this.strategyRepo.create({
          name: body.name,
          scopeType: body.scopeType,
          scopeValue: body.scopeValue,
          cycleDays: body.cycleDays,
          ownerUserId: body.ownerUserId,
          active: body.active ?? true,
        }),
      );
      await this.audit.log({
        operator,
        action: 'stocktake.strategy.create',
        docNo: String(saved.id),
        after: saved,
        result: 'SUCCESS',
      });
      return saved;
    });
  }

  // ---------- 任务生成（REQ-018，幂等） ----------

  /**
   * 生成当期待盘任务：按策略到期计算（上次生成日期 + 周期天数 <= 今天）。
   * 幂等：(strategyId, generatedDate) 唯一，同日重复生成不产生重复任务。
   */
  async generateTasks(operator: string, requestId: string, date: Date = new Date()) {
    return this.idem.execute(requestId, 'stocktake.tasks.generate', async () => {
      const today = fmtDate(date);
      const strategies = await this.strategyRepo.find({ where: { active: true } });
      const created: StocktakeTask[] = [];
      const skipped: { strategyId: number; reason: string }[] = [];

      for (const st of strategies) {
        const latest = await this.taskRepo.findOne({
          where: { strategyId: st.id },
          order: { generatedDate: 'DESC' },
        });
        if (latest) {
          const elapsed = (new Date(today).getTime() - new Date(latest.generatedDate).getTime()) / DAY_MS;
          if (elapsed < st.cycleDays) {
            skipped.push({ strategyId: st.id, reason: 'NOT_DUE' });
            continue;
          }
        }
        // 同日已生成（并发/重复调用兜底，唯一约束之外的快速路径）
        const sameDay = await this.taskRepo.findOne({
          where: { strategyId: st.id, generatedDate: today },
        });
        if (sameDay) {
          skipped.push({ strategyId: st.id, reason: 'ALREADY_GENERATED_TODAY' });
          continue;
        }

        const lots = await this.resolveScopeLots(st);
        // A 类及高风险默认盲盘
        const blind = st.scopeType === StocktakeScopeType.ABC && st.scopeValue === 'A';
        // 编号器自带事务，须在业务事务外取号（sqljs 单连接不支持嵌套事务）
        const taskNo = await this.numbering.next('STK', date);
        try {
          const task = await this.ds.transaction(async (em) => {
            const t = await em.getRepository(StocktakeTask).save(
              em.getRepository(StocktakeTask).create({
                taskNo,
                taskType: StocktakeTaskType.CYCLE,
                strategyId: st.id,
                generatedDate: today,
                status: StocktakeTaskStatus.OPEN,
                blind,
                freezeMode: FreezeMode.NONE,
                freezeActive: false,
                ownerUserId: st.ownerUserId,
              }),
            );
            for (const lot of lots) {
              await em.getRepository(StocktakeSnapshot).save(
                em.getRepository(StocktakeSnapshot).create({
                  taskId: t.id,
                  lineNo: `${taskNo}|${lot.locationCode}|${lot.materialCode}|${lot.batchNo}`,
                  packageNo: lot.packageNo,
                  materialCode: lot.materialCode,
                  batchNo: lot.batchNo,
                  warehouseCode: lot.warehouseCode,
                  locationCode: lot.locationCode,
                  bookQty: lot.qty,
                  priorStatus: null,
                  actualQty: null,
                  recountQty: null,
                  needRecount: false,
                  reason: null,
                  status: SnapshotLineStatus.PENDING,
                  countedBy: null,
                  recountedBy: null,
                  postedQty: null,
                }),
              );
            }
            return t;
          });
          created.push(task);
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (msg.includes('UNIQUE') || msg.includes('unique')) {
            skipped.push({ strategyId: st.id, reason: 'ALREADY_GENERATED_TODAY' });
            continue;
          }
          throw e;
        }
      }
      return { generatedDate: today, created, skipped };
    });
  }

  /** 策略范围 → 命中批次（拍快照用） */
  private async resolveScopeLots(st: StocktakeStrategy): Promise<StockLot[]> {
    if (st.scopeType === StocktakeScopeType.ABC) {
      const materials = await this.materialRepo.find({ where: { abcClass: st.scopeValue as any } });
      const codes = materials.map((m) => m.materialCode);
      if (!codes.length) return [];
      return this.lotRepo
        .createQueryBuilder('l')
        .where('l.materialCode IN (:...codes)', { codes })
        .andWhere('l.qty > 0')
        .orderBy('l.receivedAt', 'ASC')
        .getMany();
    }
    if (st.scopeType === StocktakeScopeType.MATERIAL) {
      let codes: string[] = [];
      try {
        codes = JSON.parse(st.scopeValue);
      } catch {
        codes = [st.scopeValue];
      }
      if (!codes.length) return [];
      return this.lotRepo
        .createQueryBuilder('l')
        .where('l.materialCode IN (:...codes)', { codes })
        .andWhere('l.qty > 0')
        .orderBy('l.receivedAt', 'ASC')
        .getMany();
    }
    // AREA：库区下所有库位的批次
    const locations = await this.locationRepo.find({ where: { areaCode: st.scopeValue } });
    const locCodes = locations.map((l) => l.locationCode);
    if (!locCodes.length) return [];
    return this.lotRepo
      .createQueryBuilder('l')
      .where('l.locationCode IN (:...locCodes)', { locCodes })
      .andWhere('l.qty > 0')
      .orderBy('l.receivedAt', 'ASC')
      .getMany();
  }

  // ---------- 任务查询（盲盘字段过滤） ----------

  listTasks(status?: string) {
    return this.taskRepo.find({
      where: status ? { status: status as StocktakeTaskStatus } : {},
      order: { id: 'DESC' },
    });
  }

  async getTask(id: number, actor: ActorContext) {
    const task = await this.mustGetTask(id);
    const lines = await this.snapRepo.find({ where: { taskId: task.id }, order: { id: 'ASC' } });
    const hideBook = this.isBlindFor(task, actor);
    return {
      ...task,
      lines: lines.map((l) => this.lineView(task, l, hideBook)),
    };
  }

  /** 盲盘任务对初盘人（非主管/管理员）隐藏账面数与差异 */
  private isBlindFor(task: StocktakeTask, actor: ActorContext): boolean {
    if (!task.blind) return false;
    return !actor.roles.includes('WH_MANAGER') && !actor.roles.includes('ADMIN');
  }

  private lineView(task: StocktakeTask, l: StocktakeSnapshot, hideBook: boolean) {
    const finalQty = l.recountQty ?? l.actualQty;
    const view: Record<string, unknown> = {
      lineNo: l.lineNo,
      packageNo: l.packageNo,
      materialCode: l.materialCode,
      batchNo: l.batchNo,
      warehouseCode: l.warehouseCode,
      locationCode: l.locationCode,
      actualQty: l.actualQty,
      recountQty: l.recountQty,
      needRecount: l.needRecount,
      reason: l.reason,
      status: l.status,
      countedBy: l.countedBy,
      recountedBy: l.recountedBy,
    };
    if (!hideBook) {
      view.bookQty = l.bookQty;
      view.diff = finalQty != null ? finalQty - l.bookQty : null;
    }
    return view;
  }

  // ---------- PDA 盘点提交 / 复盘（REQ-019） ----------

  async count(
    taskId: number,
    body: { lineNo: string; actualQty: number; reason?: string },
    actor: ActorContext,
    requestId: string,
  ) {
    if (!body?.lineNo || body.actualQty == null) {
      throw new BizException('COUNT_FIELDS_REQUIRED', 'lineNo and actualQty are required');
    }
    return this.idem.execute(requestId, `stocktake.count.${taskId}.${body.lineNo}`, async () => {
      const task = await this.mustGetTask(taskId);
      if (task.status === StocktakeTaskStatus.COMPLETED) {
        throw new BizException('TASK_COMPLETED', `Task ${task.taskNo} already completed`);
      }
      const line = await this.mustGetLine(taskId, body.lineNo);
      if (line.status !== SnapshotLineStatus.PENDING) {
        throw new BizException(
          'DUPLICATE_COUNT',
          `Line ${body.lineNo} already submitted (status ${line.status})`,
        );
      }
      const book = await this.effectiveBookQty(task, line);
      const material = await this.materialRepo.findOne({ where: { materialCode: line.materialCode } });
      const diff = body.actualQty - book;
      const needRecount = await this.isOverThreshold(material?.abcClass ?? 'UNSET', book, diff);

      line.actualQty = body.actualQty;
      line.needRecount = needRecount;
      line.reason = body.reason ?? null;
      line.countedBy = actor.username;
      line.status = SnapshotLineStatus.COUNTED;
      await this.snapRepo.save(line);

      if (task.status === StocktakeTaskStatus.OPEN) {
        task.status = StocktakeTaskStatus.COUNTING;
        await this.taskRepo.save(task);
      }
      await this.audit.log({
        operator: actor.username,
        action: 'stocktake.count',
        docNo: task.taskNo,
        after: { lineNo: line.lineNo, actualQty: body.actualQty, needRecount },
        result: 'SUCCESS',
      });
      const res: Record<string, unknown> = {
        lineNo: line.lineNo,
        actualQty: body.actualQty,
        needRecount,
        status: line.status,
      };
      // 盲盘不向初盘人回传账面/差异
      if (!this.isBlindFor(task, actor)) {
        res.bookQty = book;
        res.diff = diff;
      }
      return res;
    });
  }

  async recount(
    taskId: number,
    body: { lineNo: string; actualQty: number; reason?: string },
    actor: ActorContext,
    requestId: string,
  ) {
    if (!body?.lineNo || body.actualQty == null) {
      throw new BizException('RECOUNT_FIELDS_REQUIRED', 'lineNo and actualQty are required');
    }
    return this.idem.execute(requestId, `stocktake.recount.${taskId}.${body.lineNo}`, async () => {
      const task = await this.mustGetTask(taskId);
      const line = await this.mustGetLine(taskId, body.lineNo);
      if (line.status !== SnapshotLineStatus.COUNTED || !line.needRecount) {
        throw new BizException('RECOUNT_NOT_REQUIRED', `Line ${body.lineNo} does not require recount`);
      }
      if (line.countedBy === actor.username) {
        throw new BizException(
          'RECOUNT_SECOND_PERSON_REQUIRED',
          'Recount must be done by a second person (not the first counter)',
        );
      }
      if (!body.reason) {
        throw new BizException('REASON_REQUIRED', 'Reason is required for over-threshold recount');
      }
      line.recountQty = body.actualQty;
      line.recountedBy = actor.username;
      line.reason = body.reason;
      line.status = SnapshotLineStatus.RECOUNTED;
      await this.snapRepo.save(line);
      await this.audit.log({
        operator: actor.username,
        action: 'stocktake.recount',
        docNo: task.taskNo,
        after: { lineNo: line.lineNo, recountQty: body.actualQty, reason: body.reason },
        result: 'SUCCESS',
      });
      const book = await this.effectiveBookQty(task, line);
      return {
        lineNo: line.lineNo,
        recountQty: body.actualQty,
        diff: body.actualQty - book,
        status: line.status,
      };
    });
  }

  /** 阈值判定（RuleConfig stocktake.diffThreshold）：数量阈值+比例阈值组合；账面为 0 时仅按数量判断 */
  private async isOverThreshold(abcClass: string, bookQty: number, diff: number): Promise<boolean> {
    const cfg = await this.getJsonConfig('stocktake.diffThreshold', DEFAULT_DIFF_THRESHOLD);
    const t: DiffThreshold = cfg[abcClass] ?? cfg['default'];
    const abs = Math.abs(diff);
    if (abs <= 0) return false;
    if (abs > t.qty) return true;
    if (bookQty === 0) return false; // 账面为 0 仅按数量判断，上面已判定
    return abs / Math.abs(bookQty) > t.ratio;
  }

  // ---------- 冻结 / 解冻（REQ-020） ----------

  async freeze(
    taskId: number,
    mode: 'HARD' | 'SOFT',
    actor: ActorContext,
    requestId: string,
  ) {
    if (mode !== 'HARD' && mode !== 'SOFT') {
      throw new BizException('FREEZE_MODE_INVALID', "mode must be 'HARD' or 'SOFT'");
    }
    return this.idem.execute(requestId, `stocktake.freeze.${taskId}`, async () => {
      const task = await this.mustGetTask(taskId);
      if (task.freezeActive) {
        throw new BizException('ALREADY_FROZEN', `Task ${task.taskNo} already frozen (${task.freezeMode})`);
      }
      const lines = await this.snapRepo.find({ where: { taskId: task.id } });

      if (mode === 'HARD') {
        // 硬冻结：范围内批次 changeStatus → FROZEN，记录原状态供解冻恢复
        for (const line of lines) {
          const lot = await this.lotRepo.findOne({ where: { packageNo: line.packageNo } });
          if (!lot) continue;
          line.priorStatus = lot.status;
          await this.snapRepo.save(line);
          if (lot.status !== StockStatus.FROZEN) {
            await this.inv.changeStatus(
              line.packageNo,
              StockStatus.FROZEN,
              task.taskNo,
              `${requestId}:${line.packageNo}`,
              actor.username,
            );
          }
        }
        task.freezeMode = FreezeMode.HARD;
        task.freezeActive = true;
        await this.taskRepo.save(task);
        await this.audit.log({
          operator: actor.username,
          action: 'stocktake.freeze',
          docNo: task.taskNo,
          after: { mode, packages: lines.map((l) => l.packageNo) },
          result: 'SUCCESS',
        });
        return { taskNo: task.taskNo, mode, status: 'FROZEN', frozen: lines.length };
      }

      // 软冻结：连续生产场景，需仓库主管审批后生效
      const ap = await this.approval.create('stocktake.softFreeze', String(task.id), actor.username, [
        { approverRole: 'WH_MANAGER' },
      ]);
      task.freezeMode = FreezeMode.SOFT;
      task.softApprovalId = ap.id;
      await this.taskRepo.save(task);
      await this.audit.log({
        operator: actor.username,
        action: 'stocktake.freeze.apply',
        docNo: task.taskNo,
        after: { mode, approvalId: ap.id },
        result: 'SUCCESS',
      });
      return { taskNo: task.taskNo, mode, status: 'PENDING_APPROVAL', approvalId: ap.id };
    });
  }

  /** 审批回调：软冻结审批通过 → 冻结生效 */
  async onApprovalActed(approvalId: number) {
    const ap = await this.approval.get(approvalId);
    if (ap.bizType === 'stocktake.softFreeze' && ap.status === ApprovalStatus.APPROVED) {
      const task = await this.mustGetTask(Number(ap.bizId));
      if (!task.freezeActive) {
        task.freezeActive = true;
        await this.taskRepo.save(task);
        await this.audit.log({
          operator: ap.applicantId,
          action: 'stocktake.freeze',
          docNo: task.taskNo,
          after: { mode: 'SOFT', approvalId },
          result: 'SUCCESS',
        });
      }
    }
    return ap;
  }

  /**
   * 解冻。硬冻结：批次恢复原状态。
   * 软冻结：逐笔对账（账面=快照+冻结后合法变动 vs 当前实物账），返回对账清单。
   */
  async unfreeze(taskId: number, actor: ActorContext, requestId: string) {
    return this.idem.execute(requestId, `stocktake.unfreeze.${taskId}`, async () => {
      const task = await this.mustGetTask(taskId);
      if (!task.freezeActive) {
        throw new BizException('NOT_FROZEN', `Task ${task.taskNo} is not frozen`);
      }
      const lines = await this.snapRepo.find({ where: { taskId: task.id } });

      if (task.freezeMode === FreezeMode.HARD) {
        const restored: string[] = [];
        for (const line of lines) {
          const lot = await this.lotRepo.findOne({ where: { packageNo: line.packageNo } });
          if (lot && lot.status === StockStatus.FROZEN) {
            await this.inv.changeStatus(
              line.packageNo,
              (line.priorStatus as StockStatus) ?? StockStatus.QUALIFIED,
              task.taskNo,
              `${requestId}:${line.packageNo}`,
              actor.username,
            );
            restored.push(line.packageNo);
          }
        }
        task.freezeActive = false;
        await this.taskRepo.save(task);
        await this.audit.log({
          operator: actor.username,
          action: 'stocktake.unfreeze',
          docNo: task.taskNo,
          after: { mode: 'HARD', restored },
          result: 'SUCCESS',
        });
        return { taskNo: task.taskNo, mode: 'HARD', restored };
      }

      // 软冻结解冻：逐笔对账清单
      const reconciliation: Record<string, unknown>[] = [];
      for (const line of lines) {
        const movementSum = await this.frozenMovementSum(task.id, line.packageNo);
        const lot = await this.lotRepo.findOne({ where: { packageNo: line.packageNo } });
        const expectedQty = line.bookQty + movementSum;
        const currentQty = lot?.qty ?? 0;
        reconciliation.push({
          lineNo: line.lineNo,
          packageNo: line.packageNo,
          materialCode: line.materialCode,
          batchNo: line.batchNo,
          snapshotQty: line.bookQty,
          movementSum,
          expectedQty,
          currentQty,
          match: expectedQty === currentQty,
        });
      }
      task.freezeActive = false;
      await this.taskRepo.save(task);
      await this.audit.log({
        operator: actor.username,
        action: 'stocktake.unfreeze',
        docNo: task.taskNo,
        after: { mode: 'SOFT', reconciliation },
        result: 'SUCCESS',
      });
      return { taskNo: task.taskNo, mode: 'SOFT', reconciliation };
    });
  }

  /** 软冻结期间变动隔离记录（仅软冻结生效中可记） */
  async recordFrozenMovement(
    taskId: number,
    body: { packageNo: string; movementType: string; qtyChange: number; docNo: string },
    actor: ActorContext,
    requestId: string,
  ) {
    if (!body?.packageNo || body.qtyChange == null || !body.docNo) {
      throw new BizException('FROZEN_MOVEMENT_FIELDS_REQUIRED', 'packageNo/qtyChange/docNo are required');
    }
    return this.idem.execute(requestId, `stocktake.frozenMovement.${taskId}`, async () => {
      const task = await this.mustGetTask(taskId);
      if (task.freezeMode !== FreezeMode.SOFT || !task.freezeActive) {
        throw new BizException('SOFT_FREEZE_NOT_ACTIVE', `Task ${task.taskNo} is not in active soft freeze`);
      }
      const line = await this.snapRepo.findOne({
        where: { taskId: task.id, packageNo: body.packageNo },
      });
      if (!line) {
        throw new BizException('NOT_IN_SCOPE', `packageNo ${body.packageNo} not in task scope`);
      }
      const saved = await this.fmRepo.save(
        this.fmRepo.create({
          taskId: task.id,
          packageNo: body.packageNo,
          materialCode: line.materialCode,
          movementType: body.movementType ?? 'ADJUST',
          qtyChange: body.qtyChange,
          docNo: body.docNo,
          operator: actor.username,
        }),
      );
      return saved;
    });
  }

  /**
   * 冻结守卫（供其他模块调用）：范围内任一批次处于 FROZEN → 拒绝占用/出库/调整。
   * 年度硬冻结期间的业务拒绝统一走此检查。
   */
  async assertNotFrozen(packageNos: string[]): Promise<void> {
    for (const pkg of packageNos) {
      const lot = await this.lotRepo.findOne({ where: { packageNo: pkg } });
      if (lot?.status === StockStatus.FROZEN) {
        throw new BizException('LOT_FROZEN', `packageNo ${pkg} is FROZEN by stocktake`, 409);
      }
    }
  }

  // ---------- 差异审批过账 ----------

  /**
   * 审批后差异过账：
   * 1. 初盘人不得自行过账（提交人与过账人同账号拒绝）；
   * 2. 首次调用创建审批单（仓库主管），审批中返回 PENDING_APPROVAL；
   * 3. 审批通过后 InventoryService.adjust 更新账面 + SyncService.enqueue 同步 U8。
   */
  async postAdjustments(taskId: number, actor: ActorContext, requestId: string) {
    return this.idem.execute(requestId, `stocktake.postAdjustments.${taskId}`, async () => {
      const task = await this.mustGetTask(taskId);
      if (task.status === StocktakeTaskStatus.COMPLETED) {
        return { taskNo: task.taskNo, status: 'COMPLETED', posted: 0 };
      }
      const lines = await this.snapRepo.find({ where: { taskId: task.id }, order: { id: 'ASC' } });
      if (lines.some((l) => l.status === SnapshotLineStatus.PENDING)) {
        throw new BizException('LINES_PENDING', 'All lines must be counted before posting');
      }
      if (lines.some((l) => l.needRecount && l.status === SnapshotLineStatus.COUNTED)) {
        throw new BizException('RECOUNT_REQUIRED', 'Over-threshold lines must be recounted first');
      }

      const diffLines: { line: StocktakeSnapshot; book: number; finalQty: number; diff: number }[] = [];
      for (const line of lines) {
        const book = await this.effectiveBookQty(task, line);
        const finalQty = (line.recountQty ?? line.actualQty)!;
        const diff = finalQty - book;
        if (diff !== 0 && line.status !== SnapshotLineStatus.POSTED) {
          diffLines.push({ line, book, finalQty, diff });
        }
      }
      // 初盘人不得自行过账差异
      if (diffLines.some((d) => d.line.countedBy === actor.username)) {
        throw new BizException(
          'SELF_POST_FORBIDDEN',
          'First counter cannot post adjustments (submitter == poster forbidden)',
          403,
        );
      }

      if (!diffLines.length) {
        for (const line of lines) {
          line.status = SnapshotLineStatus.POSTED;
          line.postedQty = line.recountQty ?? line.actualQty;
          await this.snapRepo.save(line);
        }
        task.status = StocktakeTaskStatus.COMPLETED;
        await this.taskRepo.save(task);
        return { taskNo: task.taskNo, status: 'COMPLETED', posted: 0 };
      }

      // 审批流：仓库主管（大额差异可由 RuleConfig 扩展加签财务）
      if (!task.adjustApprovalId) {
        const ap = await this.approval.create('stocktake.adjust', task.taskNo, actor.username, [
          { approverRole: 'WH_MANAGER' },
        ]);
        task.adjustApprovalId = ap.id;
        await this.taskRepo.save(task);
        return { taskNo: task.taskNo, status: 'PENDING_APPROVAL', approvalId: ap.id };
      }
      const ap = await this.approval.get(task.adjustApprovalId);
      if (ap.status === ApprovalStatus.PENDING) {
        return { taskNo: task.taskNo, status: 'PENDING_APPROVAL', approvalId: ap.id };
      }
      if (ap.status !== ApprovalStatus.APPROVED) {
        throw new BizException('APPROVAL_NOT_APPROVED', `Adjustment approval is ${ap.status}`);
      }

      // 执行过账：adjust 更新账面（目标数=最终实盘），再入队 U8 盘点调整单
      const before = diffLines.map((d) => ({ packageNo: d.line.packageNo, bookQty: d.book }));
      for (const d of diffLines) {
        await this.inv.adjust(
          d.line.packageNo,
          d.finalQty,
          d.line.reason ?? `盘点差异调整 ${task.taskNo}`,
          task.taskNo,
          `${requestId}:${d.line.lineNo}`,
          actor.username,
        );
        d.line.postedQty = d.finalQty;
        d.line.status = SnapshotLineStatus.POSTED;
        await this.snapRepo.save(d.line);
      }
      for (const line of lines) {
        if (line.status !== SnapshotLineStatus.POSTED) {
          line.postedQty = line.recountQty ?? line.actualQty;
          line.status = SnapshotLineStatus.POSTED;
          await this.snapRepo.save(line);
        }
      }
      const payload = {
        taskNo: task.taskNo,
        approvalId: ap.id,
        lines: diffLines.map((d) => ({
          packageNo: d.line.packageNo,
          materialCode: d.line.materialCode,
          batchNo: d.line.batchNo,
          locationCode: d.line.locationCode,
          bookQty: d.book,
          actualQty: d.finalQty,
          diff: d.diff,
          reason: d.line.reason,
        })),
      };
      const syncTask = await this.sync.enqueue({
        bizType: 'stocktake',
        bizKey: `STKADJ-${task.taskNo}`,
        voucherType: 'STOCKTAKE_ADJ',
        payload,
      });
      task.status = StocktakeTaskStatus.COMPLETED;
      await this.taskRepo.save(task);
      await this.audit.log({
        operator: actor.username,
        action: 'stocktake.postAdjustments',
        docNo: task.taskNo,
        before,
        after: payload.lines,
        result: 'SUCCESS',
      });
      return {
        taskNo: task.taskNo,
        status: 'COMPLETED',
        posted: diffLines.length,
        syncStatus: syncTask.status,
      };
    });
  }

  // ---------- 报告 / 库龄 ----------

  /** 一键盘点报告（REQ-020）：账面、实盘、差异、差异率、原因 + 按库区/物料大类/责任人汇总 */
  async report(taskId: number) {
    const task = await this.mustGetTask(taskId);
    const lines = await this.snapRepo.find({ where: { taskId: task.id }, order: { id: 'ASC' } });
    const locations = await this.locationRepo.find();
    const areaOf = new Map(locations.map((l) => [l.locationCode, l.areaCode]));
    const materials = await this.materialRepo.find();
    const abcOf = new Map(materials.map((m) => [m.materialCode, m.abcClass]));

    const rows: Record<string, unknown>[] = [];
    const group = (keyOf: (l: StocktakeSnapshot) => string) => {
      const m = new Map<string, { book: number; actual: number; diff: number }>();
      return { m, keyOf };
    };
    const byArea = group((l) => areaOf.get(l.locationCode) ?? 'UNKNOWN');
    const byAbc = group((l) => abcOf.get(l.materialCode) ?? 'UNSET');
    const byOwner = group(() => task.ownerUserId ?? 'UNASSIGNED');
    const groups = [byArea, byAbc, byOwner];

    let totalBook = 0;
    let totalActual = 0;
    let totalDiff = 0;
    let totalPosted = 0;
    for (const line of lines) {
      const movementSum =
        task.freezeMode === FreezeMode.SOFT ? await this.frozenMovementSum(task.id, line.packageNo) : 0;
      const book = line.bookQty + movementSum;
      const finalQty = line.recountQty ?? line.actualQty;
      const diff = finalQty != null ? finalQty - book : null;
      rows.push({
        lineNo: line.lineNo,
        packageNo: line.packageNo,
        materialCode: line.materialCode,
        batchNo: line.batchNo,
        locationCode: line.locationCode,
        areaCode: areaOf.get(line.locationCode) ?? 'UNKNOWN',
        abcClass: abcOf.get(line.materialCode) ?? 'UNSET',
        bookQty: book,
        snapshotQty: line.bookQty,
        frozenMovementSum: movementSum,
        actualQty: finalQty,
        diff,
        diffRate: diff != null && book !== 0 ? diff / book : null,
        reason: line.reason,
        countedBy: line.countedBy,
        recountedBy: line.recountedBy,
        postedQty: line.postedQty,
        status: line.status,
      });
      totalBook += book;
      totalActual += finalQty ?? 0;
      totalDiff += diff ?? 0;
      totalPosted += line.postedQty != null ? line.postedQty - book : 0;
      for (const g of groups) {
        const key = g.keyOf(line);
        const acc = g.m.get(key) ?? { book: 0, actual: 0, diff: 0 };
        acc.book += book;
        acc.actual += finalQty ?? 0;
        acc.diff += diff ?? 0;
        g.m.set(key, acc);
      }
    }
    const toArr = (g: { m: Map<string, { book: number; actual: number; diff: number }> }) =>
      [...g.m.entries()].map(([key, v]) => ({ key, ...v }));
    return {
      taskNo: task.taskNo,
      taskType: task.taskType,
      status: task.status,
      blind: task.blind,
      freezeMode: task.freezeMode,
      ownerUserId: task.ownerUserId,
      lines: rows,
      totals: {
        bookQty: totalBook,
        actualQty: totalActual,
        diff: totalDiff,
        diffRate: totalBook !== 0 ? totalDiff / totalBook : null,
        postedDiff: totalPosted,
      },
      summary: {
        byArea: toArr(byArea),
        byAbcClass: toArr(byAbc),
        byOwner: toArr(byOwner),
      },
      /** 三账一致校验：报告差异合计 == 已过账调整合计 */
      consistency: {
        reportDiff: totalDiff,
        postedDiff: totalPosted,
        consistent: task.status === StocktakeTaskStatus.COMPLETED ? totalDiff === totalPosted : null,
      },
    };
  }

  /**
   * 库龄分析（会议纪要新增）：
   * 连续 3 个月（90 天）无出入库 → WARN_3M 预警；
   * 达到重检周期（RuleConfig stocktake.reinspectDays，按物料种类差异化，默认五金 180/塑料 365）→ REINSPECT_DUE。
   */
  async aging() {
    const cfg = await this.getJsonConfig('stocktake.reinspectDays', DEFAULT_REINSPECT_DAYS);
    const lots = await this.lotRepo.find();
    const materials = await this.materialRepo.find();
    const matOf = new Map(materials.map((m) => [m.materialCode, m]));
    // 每批次最近移动日期（无流水则退回入库日期）
    const lastMoves = await this.movRepo
      .createQueryBuilder('m')
      .select('m.packageNo', 'packageNo')
      .addSelect('MAX(m.createdAt)', 'lastAt')
      .where('m.packageNo IS NOT NULL')
      .groupBy('m.packageNo')
      .getRawMany();
    const lastMoveOf = new Map<string, Date>(
      lastMoves.map((r: any) => [r.packageNo, new Date(r.lastAt)]),
    );

    const now = Date.now();
    const rows = lots.map((lot) => {
      const mat = matOf.get(lot.materialCode);
      const lastMove = lastMoveOf.get(lot.packageNo) ?? lot.receivedAt;
      const daysSinceMove = Math.floor((now - new Date(lastMove).getTime()) / DAY_MS);
      const ageDays = Math.floor((now - new Date(lot.receivedAt).getTime()) / DAY_MS);
      const reinspectDays = this.reinspectDaysOf(cfg, mat?.name ?? '');
      let level = 'NONE';
      if (daysSinceMove >= reinspectDays) level = 'REINSPECT_DUE';
      else if (daysSinceMove >= AGING_WARN_DAYS) level = 'WARN_3M';
      return {
        packageNo: lot.packageNo,
        materialCode: lot.materialCode,
        materialName: mat?.name ?? null,
        batchNo: lot.batchNo,
        locationCode: lot.locationCode,
        qty: lot.qty,
        receivedAt: lot.receivedAt,
        lastMoveDate: lastMove,
        ageDays,
        daysSinceMove,
        reinspectDays,
        level,
      };
    });
    rows.sort((a, b) => b.daysSinceMove - a.daysSinceMove);
    return rows;
  }

  /** 按物料名称匹配物料种类配置（如名称含“五金”→ 180 天），缺省 default */
  private reinspectDaysOf(cfg: Record<string, number>, materialName: string): number {
    for (const [k, v] of Object.entries(cfg)) {
      if (k !== 'default' && materialName.includes(k)) return Number(v);
    }
    return Number(cfg['default'] ?? 270);
  }

  // ---------- internals ----------

  /** 有效账面 = 快照 + 冻结后合法变动（软冻结隔离记录合计） */
  private async effectiveBookQty(task: StocktakeTask, line: StocktakeSnapshot): Promise<number> {
    if (task.freezeMode !== FreezeMode.SOFT) return line.bookQty;
    return line.bookQty + (await this.frozenMovementSum(task.id, line.packageNo));
  }

  private async frozenMovementSum(taskId: number, packageNo: string): Promise<number> {
    const raw = await this.fmRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.qtyChange), 0)', 'sum')
      .where('f.taskId = :taskId', { taskId })
      .andWhere('f.packageNo = :packageNo', { packageNo })
      .getRawOne();
    return Number(raw?.sum ?? 0);
  }

  private async getJsonConfig<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.ruleConfig.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async mustGetTask(id: number): Promise<StocktakeTask> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) throw new BizException('TASK_NOT_FOUND', `Stocktake task ${id} not found`, 404);
    return task;
  }

  private async mustGetLine(taskId: number, lineNo: string): Promise<StocktakeSnapshot> {
    const line = await this.snapRepo.findOne({ where: { taskId, lineNo } });
    if (!line) throw new BizException('LINE_NOT_FOUND', `Line ${lineNo} not found in task ${taskId}`, 404);
    return line;
  }
}
