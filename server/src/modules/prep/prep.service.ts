import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocStatus, StockStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { DocStatusMachine } from '../../common/doc-status.machine';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { RuleConfigService } from '../config/rule-config.service';
import { InventoryService } from '../inventory/inventory.service';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { SyncService } from '../integration/sync.service';
import { Location } from '../masterdata/entities/location.entity';
import { KittingService } from './kitting.service';
import { PrepTask, PrepTaskStatus } from './entities/prep-task.entity';
import { PrepTaskLine } from './entities/prep-task-line.entity';
import { PrepScanRecord } from './entities/prep-scan-record.entity';
import { PrepOrder } from './entities/prep-order.entity';
import { PrepOrderLine } from './entities/prep-order-line.entity';
import { ReversalDoc } from './entities/reversal-doc.entity';

export interface LeftoverReminder {
  flag: boolean;
  items: { materialCode: string; requiredQty: number; preparedQty: number; leftoverQty: number }[];
}

/**
 * 生产发料链核心服务（REQ-005~008 + 纪要）：
 * 备料任务（齐套门禁/紧急放行）→ 扫码累计（FIFO+同库区推荐储位）→ 完成生成备料单
 * （只加 MES 占用）→ 物权交接双确认 → U8 材料出库 → 扣实物+释放占用 → 过账前退回 / 过账后更正。
 */
@Injectable()
export class PrepService {
  constructor(
    @InjectRepository(PrepTask)
    private readonly taskRepo: Repository<PrepTask>,
    @InjectRepository(PrepTaskLine)
    private readonly lineRepo: Repository<PrepTaskLine>,
    @InjectRepository(PrepScanRecord)
    private readonly scanRepo: Repository<PrepScanRecord>,
    @InjectRepository(PrepOrder)
    private readonly orderRepo: Repository<PrepOrder>,
    @InjectRepository(PrepOrderLine)
    private readonly orderLineRepo: Repository<PrepOrderLine>,
    @InjectRepository(ReversalDoc)
    private readonly reversalRepo: Repository<ReversalDoc>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    private readonly kitting: KittingService,
    private readonly inv: InventoryService,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly ruleConfig: RuleConfigService,
  ) {}

  // ---------- 备料任务 ----------

  /** 创建备料任务：未齐套整单拒绝（返回缺料清单）；紧急生产按规则放行并审计 */
  async createTask(workOrderId: string, emergencyReason: string | undefined, operator: string) {
    // 重复提交不重复建任务：同工单存在未完成任务则直接返回
    const existing = await this.taskRepo.findOne({
      where: { workOrderId, status: PrepTaskStatus.OPEN },
    });
    if (existing) return this.getTask(existing.id);
    const suspended = await this.taskRepo.findOne({
      where: { workOrderId, status: PrepTaskStatus.SUSPENDED },
    });
    if (suspended) return this.getTask(suspended.id);

    const k = await this.kitting.compute(workOrderId);
    let emergency = false;
    if (!k.kitting) {
      const allowEmergency = (await this.ruleConfig.get('prep.allowEmergency')) === 'true';
      if (allowEmergency && emergencyReason) {
        emergency = true;
        await this.audit.log({
          operator,
          action: 'prep.emergencyOverride',
          docNo: workOrderId,
          after: { emergencyReason, shortageLines: k.shortageLines },
          result: 'SUCCESS',
        });
      } else {
        throw new BizException(
          'KITTING_SHORTAGE',
          `工单 ${workOrderId} 未齐套，整单备料被拒。缺料明细:${JSON.stringify(k.shortageLines)}`,
        );
      }
    }

    const taskNo = await this.numbering.next('PT');
    const task = await this.taskRepo.save(
      this.taskRepo.create({
        taskNo,
        workOrderId,
        status: PrepTaskStatus.OPEN,
        emergency,
        emergencyReason: emergency ? emergencyReason! : null,
        createdBy: operator,
      }),
    );
    for (const l of k.lines) {
      await this.lineRepo.save(
        this.lineRepo.create({
          taskId: task.id,
          materialCode: l.materialCode,
          requiredQty: l.requiredQty,
          preparedQty: 0,
          unit: l.unit,
        }),
      );
    }
    return this.getTask(task.id);
  }

  /** 任务详情（含进度与推荐储位），中断重登后据此恢复 */
  async getTask(taskId: number) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BizException('PREP_TASK_NOT_FOUND', `Prep task ${taskId} not found`, 404);
    const lines = await this.lineRepo.find({ where: { taskId: task.id } });
    const scans = await this.scanRepo.find({ where: { taskId: task.id }, order: { id: 'ASC' } });
    const recommendations = await this.recommendLocations(lines);
    const order = await this.orderRepo.findOne({ where: { taskNo: task.taskNo } });
    return { task, lines, scans, recommendations, prepDocNo: order?.prepDocNo ?? null };
  }

  /**
   * 推荐储位：策略存 RuleConfig prep.locationStrategy。
   * FIFO_AREA（默认）：同库区集中（库区总量降序），库区内按 receivedAt 先进先出；
   * FIFO：纯按 receivedAt 先进先出。
   */
  private async recommendLocations(lines: PrepTaskLine[]) {
    const strategy = (await this.ruleConfig.get('prep.locationStrategy')) ?? 'FIFO_AREA';
    const result: Record<string, any[]> = {};
    for (const line of lines) {
      const lots = await this.lotRepo.find({
        where: { materialCode: line.materialCode, status: StockStatus.QUALIFIED },
        order: { receivedAt: 'ASC' },
      });
      const usable = lots.filter((l) => l.qty > 0 && (!l.expiryDate || l.expiryDate > new Date()));
      const areas = new Map<string, string>();
      for (const l of usable) {
        if (!areas.has(l.locationCode)) {
          const loc = await this.locationRepo.findOne({ where: { locationCode: l.locationCode } });
          areas.set(l.locationCode, loc?.areaCode ?? '');
        }
      }
      let sorted = usable.map((l) => ({ ...l, areaCode: areas.get(l.locationCode) ?? '' }));
      if (strategy === 'FIFO_AREA') {
        const areaTotal = new Map<string, number>();
        for (const l of sorted) {
          areaTotal.set(l.areaCode, (areaTotal.get(l.areaCode) ?? 0) + l.qty);
        }
        sorted = sorted.sort(
          (a, b) =>
            (areaTotal.get(b.areaCode) ?? 0) - (areaTotal.get(a.areaCode) ?? 0) ||
            a.receivedAt.getTime() - b.receivedAt.getTime(),
        );
      }
      result[line.materialCode] = sorted.map((l) => ({
        packageNo: l.packageNo,
        batchNo: l.batchNo,
        warehouseCode: l.warehouseCode,
        locationCode: l.locationCode,
        areaCode: l.areaCode,
        qty: l.qty,
        receivedAt: l.receivedAt,
      }));
    }
    return result;
  }

  /** 扫包装码累计：物料须属于工单需求、批次合格可用未过期、累计不超应备；重复扫码不重复累计 */
  async scan(
    taskId: number,
    input: { packageNo: string; qty?: number; device?: string },
    operator: string,
  ) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BizException('PREP_TASK_NOT_FOUND', `Prep task ${taskId} not found`, 404);
    if (task.status === PrepTaskStatus.COMPLETED || task.status === PrepTaskStatus.CANCELLED) {
      throw new BizException('TASK_NOT_SCANNABLE', `Task in status ${task.status} cannot be scanned`);
    }
    // 中断恢复：SUSPENDED 任务扫码即恢复 OPEN，进度不丢
    if (task.status === PrepTaskStatus.SUSPENDED) {
      task.status = PrepTaskStatus.OPEN;
      await this.taskRepo.save(task);
    }

    // 重复扫码：幂等返回当前进度，不重复累计
    const dup = await this.scanRepo.findOne({
      where: { taskId: task.id, packageNo: input.packageNo },
    });
    if (dup) return { ...await this.progress(task.id), duplicated: true };

    const lot = await this.lotRepo.findOne({ where: { packageNo: input.packageNo } });
    if (!lot) throw new BizException('PACKAGE_NOT_FOUND', `packageNo ${input.packageNo} not found`, 404);
    const line = await this.lineRepo.findOne({
      where: { taskId: task.id, materialCode: lot.materialCode },
    });
    if (!line) {
      throw new BizException(
        'MATERIAL_NOT_REQUIRED',
        `Material ${lot.materialCode} is not required by work order ${task.workOrderId}`,
      );
    }
    if (lot.status !== StockStatus.QUALIFIED) {
      throw new BizException('LOT_NOT_USABLE', `Lot ${lot.packageNo} status ${lot.status} is not usable`);
    }
    if (lot.expiryDate && lot.expiryDate <= new Date()) {
      throw new BizException('LOT_EXPIRED', `Lot ${lot.packageNo} expired at ${lot.expiryDate.toISOString()}`);
    }
    const scanQty = input.qty ?? lot.qty;
    if (scanQty <= 0 || scanQty > lot.qty) {
      throw new BizException('INVALID_QTY', `Scan qty ${scanQty} invalid for lot qty ${lot.qty}`);
    }
    if (line.preparedQty + scanQty > line.requiredQty) {
      throw new BizException(
        'PREP_EXCEED_REQUIRED',
        `Material ${line.materialCode} prepared ${line.preparedQty} + ${scanQty} > required ${line.requiredQty}`,
      );
    }

    await this.scanRepo.save(
      this.scanRepo.create({
        taskId: task.id,
        packageNo: lot.packageNo,
        materialCode: lot.materialCode,
        qty: scanQty,
        operator,
        device: input.device ?? null,
      }),
    );
    line.preparedQty += scanQty;
    await this.lineRepo.save(line);
    return { ...await this.progress(task.id), duplicated: false };
  }

  /** 暂存（中断）：进度持久化，重登扫码自动恢复 */
  async suspend(taskId: number, operator: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BizException('PREP_TASK_NOT_FOUND', `Prep task ${taskId} not found`, 404);
    if (task.status !== PrepTaskStatus.OPEN) {
      throw new BizException('TASK_NOT_SUSPENDABLE', `Task in status ${task.status} cannot be suspended`);
    }
    task.status = PrepTaskStatus.SUSPENDED;
    await this.taskRepo.save(task);
    await this.audit.log({
      operator,
      action: 'prep.task.suspend',
      docNo: task.taskNo,
      result: 'SUCCESS',
    });
    return this.getTask(task.id);
  }

  /**
   * 完成备料：生成备料单 + 只增加 MES 占用（U8 现存量不变）。
   * 幂等：任务已 COMPLETED 直接返回原备料单，不重复占用。
   */
  async complete(taskId: number, operator: string, requestId: string) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new BizException('PREP_TASK_NOT_FOUND', `Prep task ${taskId} not found`, 404);
    if (task.status === PrepTaskStatus.COMPLETED) {
      const existing = await this.orderRepo.findOne({ where: { taskNo: task.taskNo } });
      if (existing) return this.getOrder(existing.prepDocNo);
    }
    if (task.status === PrepTaskStatus.CANCELLED) {
      throw new BizException('TASK_CANCELLED', 'Task is cancelled');
    }
    const lines = await this.lineRepo.find({ where: { taskId: task.id } });
    const prepared = lines.filter((l) => l.preparedQty > 0);
    if (prepared.length === 0) {
      throw new BizException('NOTHING_PREPARED', 'No material prepared, cannot complete');
    }

    const prepDocNo = await this.numbering.next('PREP');
    const order = await this.orderRepo.save(
      this.orderRepo.create({
        prepDocNo,
        taskNo: task.taskNo,
        workOrderId: task.workOrderId,
        status: DocStatus.APPROVED, // 备料单生成即生效（无审批环节）
      }),
    );
    for (const l of lines) {
      await this.orderLineRepo.save(
        this.orderLineRepo.create({
          prepDocNo,
          materialCode: l.materialCode,
          requiredQty: l.requiredQty,
          preparedQty: l.preparedQty,
          unit: l.unit,
        }),
      );
    }
    // 只增加 MES 占用；可用量不足由 InventoryService 抛 INSUFFICIENT_AVAILABLE
    await this.inv.occupy(
      task.workOrderId,
      prepared.map((l) => ({ materialCode: l.materialCode, qty: l.preparedQty })),
      prepDocNo,
      requestId,
      operator,
    );

    task.status = PrepTaskStatus.COMPLETED;
    task.completedAt = new Date();
    await this.taskRepo.save(task);
    await this.audit.log({
      operator,
      action: 'prep.order.create',
      docNo: prepDocNo,
      after: { workOrderId: task.workOrderId, items: prepared.map((l) => ({ materialCode: l.materialCode, qty: l.preparedQty })) },
      result: 'SUCCESS',
    });
    await this.kitting.recompute(task.workOrderId);
    return this.getOrder(prepDocNo);
  }

  // ---------- 物权交接 / 出库 / 退回 / 更正 ----------

  /** 双确认：仓管员 + 生产接收人，必须两个不同账号；双方确认 → U8 材料出库 → 扣实物+释放占用 */
  async confirmHandover(
    prepDocNo: string,
    input: { role: 'KEEPER' | 'RECEIVER'; device?: string },
    operator: string,
    requestId: string,
  ) {
    const order = await this.mustGetOrder(prepDocNo);
    if (order.status !== DocStatus.APPROVED) {
      throw new BizException(
        'HANDOVER_NOT_ALLOWED',
        `Prep order in status ${order.status} cannot be confirmed`,
      );
    }
    if (input.role !== 'KEEPER' && input.role !== 'RECEIVER') {
      throw new BizException('INVALID_ROLE', `role must be KEEPER or RECEIVER`);
    }
    // 同账号第二次确认直接拒绝（含跨角色）
    if (order.keeperBy === operator || order.receiverBy === operator) {
      await this.audit.log({
        operator,
        role: input.role,
        device: input.device,
        action: 'prep.handover.confirm',
        docNo: prepDocNo,
        result: 'SAME_ACCOUNT_REJECTED',
      });
      throw new BizException(
        'SAME_ACCOUNT_CONFIRM',
        `Account ${operator} has already confirmed this handover; two different accounts are required`,
      );
    }
    if (input.role === 'KEEPER') {
      if (order.keeperBy) throw new BizException('ROLE_ALREADY_CONFIRMED', 'KEEPER already confirmed');
      order.keeperBy = operator;
      order.keeperAt = new Date();
      order.keeperDevice = input.device ?? null;
    } else {
      if (order.receiverBy) throw new BizException('ROLE_ALREADY_CONFIRMED', 'RECEIVER already confirmed');
      order.receiverBy = operator;
      order.receiverAt = new Date();
      order.receiverDevice = input.device ?? null;
    }
    await this.orderRepo.save(order);
    await this.audit.log({
      operator,
      role: input.role,
      device: input.device,
      action: 'prep.handover.confirm',
      docNo: prepDocNo,
      after: { keeperBy: order.keeperBy, receiverBy: order.receiverBy },
      result: 'SUCCESS',
    });

    let syncTask: any = null;
    if (order.keeperBy && order.receiverBy) {
      // 双方确认完成 → 生成 U8 材料出库单
      order.status = DocStatusMachine.transition(order.status, DocStatus.PENDING_SYNC);
      await this.orderRepo.save(order);
      const lines = await this.orderLineRepo.find({ where: { prepDocNo } });
      syncTask = await this.sync.enqueue({
        bizType: 'prep',
        bizKey: prepDocNo,
        voucherType: 'MATERIAL_ISSUE',
        payload: {
          prepDocNo,
          workOrderId: order.workOrderId,
          keeperBy: order.keeperBy,
          receiverBy: order.receiverBy,
          lines: lines.map((l) => ({ materialCode: l.materialCode, qty: l.preparedQty, unit: l.unit })),
        },
      });
      order.u8SyncTaskId = syncTask.id;
      if (syncTask.status === DocStatus.SYNCED) {
        // U8 成功 → 扣实物 + 占用转 CONSUMED（MVP：enqueue 返回 SYNCED 后同步调用）
        await this.inv.consumeOccupation(prepDocNo, requestId, operator);
        order.status = DocStatus.SYNCED;
        order.postedAt = new Date();
        await this.orderRepo.save(order);
        await this.audit.log({
          operator,
          action: 'prep.issue.posted',
          docNo: prepDocNo,
          after: { u8SyncTaskId: syncTask.id, postedAt: order.postedAt },
          result: 'SUCCESS',
        });
        await this.kitting.recompute(order.workOrderId);
      } else {
        order.status = DocStatus.SYNC_ERROR;
        await this.orderRepo.save(order);
        await this.audit.log({
          operator,
          action: 'prep.issue.posted',
          docNo: prepDocNo,
          after: { lastError: syncTask.lastError },
          result: 'SYNC_ERROR',
        });
      }
    }
    const detail = await this.getOrder(prepDocNo);
    return { ...detail, syncTask, handoverCompleted: !!(order.keeperBy && order.receiverBy) };
  }

  /** 过账前退回：释放占用，备料单作废，退回备料任务（进度保留） */
  async rejectHandover(prepDocNo: string, reason: string | undefined, operator: string, requestId: string) {
    const order = await this.mustGetOrder(prepDocNo);
    if (order.status === DocStatus.SYNCED || order.status === DocStatus.REVERSED) {
      throw new BizException('ALREADY_POSTED_USE_REVERSAL', 'Posted order can only be corrected via reversal');
    }
    if (order.status === DocStatus.VOID) {
      throw new BizException('ALREADY_VOID', 'Prep order already void');
    }
    const before = { status: order.status };
    const released = await this.inv.releaseOccupation(prepDocNo, requestId, operator);
    order.status = DocStatusMachine.transition(order.status, DocStatus.VOID);
    await this.orderRepo.save(order);
    // 退回备料任务：任务回到 OPEN，已扫码进度保留
    const task = await this.taskRepo.findOne({ where: { taskNo: order.taskNo } });
    if (task) {
      task.status = PrepTaskStatus.OPEN;
      task.completedAt = null;
      await this.taskRepo.save(task);
    }
    await this.audit.log({
      operator,
      action: 'prep.handover.reject',
      docNo: prepDocNo,
      before,
      after: { status: order.status, released, reason: reason ?? null },
      result: 'SUCCESS',
    });
    await this.kitting.recompute(order.workOrderId);
    return this.getOrder(prepDocNo);
  }

  /** 过账后更正：创建差异单 ReversalDoc，原单状态机走 REVERSED（原单保留） */
  async reversal(prepDocNo: string, reason: string, operator: string) {
    const order = await this.mustGetOrder(prepDocNo);
    if (order.status !== DocStatus.SYNCED) {
      throw new BizException(
        'REVERSAL_NOT_ALLOWED',
        `Only SYNCED orders can be reversed (current: ${order.status})`,
      );
    }
    if (!reason) throw new BizException('REASON_REQUIRED', 'reversal reason is required');
    const existing = await this.reversalRepo.findOne({ where: { prepDocNo } });
    if (existing) return { reversal: existing, order: await this.getOrder(prepDocNo) };

    const reversalNo = await this.numbering.next('RVS');
    const reversal = await this.reversalRepo.save(
      this.reversalRepo.create({
        reversalNo,
        prepDocNo,
        reason,
        status: DocStatus.COMPLETED,
        createdBy: operator,
      }),
    );
    const before = { status: order.status };
    order.status = DocStatusMachine.transition(order.status, DocStatus.REVERSED);
    await this.orderRepo.save(order);
    await this.audit.log({
      operator,
      action: 'prep.reversal',
      docNo: prepDocNo,
      before,
      after: { status: order.status, reversalNo, reason },
      result: 'SUCCESS',
    });
    return { reversal, order: await this.getOrder(prepDocNo) };
  }

  // ---------- 查询 ----------

  async listOrders() {
    const orders = await this.orderRepo.find({ order: { id: 'DESC' } });
    const rows = [] as any[];
    for (const o of orders) rows.push(await this.getOrder(o.prepDocNo));
    return rows;
  }

  async getOrder(prepDocNo: string) {
    const order = await this.mustGetOrder(prepDocNo);
    const lines = await this.orderLineRepo.find({ where: { prepDocNo } });
    return { order, lines, leftoverReminder: this.leftoverOf(lines) };
  }

  /** AGV 预留接口（REQ-008）：仅占位数据，不做调度 */
  async agvTask(prepDocNo: string) {
    const order = await this.mustGetOrder(prepDocNo);
    const lines = await this.orderLineRepo.find({ where: { prepDocNo } });
    const first = lines[0];
    return {
      taskNo: `AGV-${prepDocNo}`,
      sourceLocation: 'STAGING', // 备料区不做正式库位（STAGING 状态标记）
      targetLine: order.workOrderId,
      materialCode: first?.materialCode ?? null,
      quantity: first?.preparedQty ?? 0,
      unit: first?.unit ?? null,
      weight: 0, // 占位：物料主数据无单重字段
    };
  }

  // ---------- internals ----------

  private async mustGetOrder(prepDocNo: string): Promise<PrepOrder> {
    const order = await this.orderRepo.findOne({ where: { prepDocNo } });
    if (!order) throw new BizException('PREP_ORDER_NOT_FOUND', `Prep order ${prepDocNo} not found`, 404);
    return order;
  }

  private async progress(taskId: number) {
    const lines = await this.lineRepo.find({ where: { taskId } });
    return {
      taskId,
      lines: lines.map((l) => ({
        materialCode: l.materialCode,
        requiredQty: l.requiredQty,
        preparedQty: l.preparedQty,
        remainingQty: l.requiredQty - l.preparedQty,
        unit: l.unit,
      })),
    };
  }

  /** 余料提醒（纪要新增）：已备未用数量 = 实备 − 应备，供余料模块消费 */
  private leftoverOf(lines: PrepOrderLine[]): LeftoverReminder {
    const items = lines
      .filter((l) => l.preparedQty - l.requiredQty > 0)
      .map((l) => ({
        materialCode: l.materialCode,
        requiredQty: l.requiredQty,
        preparedQty: l.preparedQty,
        leftoverQty: l.preparedQty - l.requiredQty,
      }));
    return { flag: items.length > 0, items };
  }
}
