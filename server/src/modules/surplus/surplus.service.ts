import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockStatus, YL_AREA_CODE } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { InventoryService } from '../inventory/inventory.service';
import { SyncService } from '../integration/sync.service';
import { RuleConfigService } from '../config/rule-config.service';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { Material } from '../masterdata/entities/material.entity';
import { Location } from '../masterdata/entities/location.entity';
import {
  SurplusRecord,
  SurplusSourceType,
  SurplusStatus,
} from './entities/surplus-record.entity';
import { SurplusReminder, ReminderStatus } from './entities/surplus-reminder.entity';
import {
  SurplusProcess,
  SurplusProcessMethod,
} from './entities/surplus-process.entity';
import { SurplusPrintLog } from './entities/surplus-print-log.entity';

export interface RegisterSurplusInput {
  packageNo: string;
  sourceType: SurplusSourceType;
  sourceDocNo: string;
  responsible: string;
  workOrderId?: string;
  occurredAt?: string; // ISO，缺省当前时间
  requestId: string;
  operator: string;
}

export interface ProcessSurplusInput {
  method: SurplusProcessMethod;
  qty: number;
  targetWorkOrderId?: string;
  requestId: string;
  operator: string;
}

const DEFAULT_REMIND_DAYS = [3, 7, 15];
const DEFAULT_LABEL_FIELDS = [
  'docNo',
  'sourceType',
  'sourceDocNo',
  'materialCode',
  'materialName',
  'qty',
  'originalQty',
  'occurredAt',
  'responsible',
];

/**
 * 余料业务：登记入 YL 余料区（SURPLUS_YL 独立记账，不计入可用量）、
 * 到期提醒（RuleConfig surplus.remindDays）、三选一处理（退供应商/用于后续订单/跨单挪用）、
 * 标签打印留痕。
 */
@Injectable()
export class SurplusService {
  constructor(
    @InjectRepository(SurplusRecord)
    private readonly recordRepo: Repository<SurplusRecord>,
    @InjectRepository(SurplusReminder)
    private readonly reminderRepo: Repository<SurplusReminder>,
    @InjectRepository(SurplusProcess)
    private readonly processRepo: Repository<SurplusProcess>,
    @InjectRepository(SurplusPrintLog)
    private readonly printRepo: Repository<SurplusPrintLog>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    private readonly inv: InventoryService,
    private readonly sync: SyncService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idem: IdempotencyService,
    private readonly ruleConfig: RuleConfigService,
  ) {}

  /** 人工登记余料：整包 changeStatus→SURPLUS_YL + moveLocation→YL 库区 */
  async register(input: RegisterSurplusInput): Promise<SurplusRecord> {
    return this.idem.execute(input.requestId, 'surplus.register', async () => {
      const lot = await this.mustGetLot(input.packageNo);
      if (lot.qty <= 0) throw new BizException('LOT_EMPTY', `packageNo ${input.packageNo} qty is 0`);
      if (lot.status === StockStatus.SURPLUS_YL) {
        throw new BizException('ALREADY_SURPLUS', `packageNo ${input.packageNo} already in YL area`);
      }
      const material = await this.materialRepo.findOne({ where: { materialCode: lot.materialCode } });
      const ylLocation = await this.mustGetYlLocation();
      const docNo = await this.numbering.next('SUR');
      const operator = input.operator;

      // 库内调拨入 YL：状态 + 库位双侧移动，qty 不变（总库存平衡，movement 双侧记录）
      await this.inv.changeStatus(input.packageNo, StockStatus.SURPLUS_YL, docNo, `${input.requestId}:status`, operator);
      await this.inv.moveLocation(input.packageNo, ylLocation.locationCode, docNo, `${input.requestId}:move`, operator);

      const record = await this.recordRepo.save(
        this.recordRepo.create({
          docNo,
          packageNo: input.packageNo,
          sourceType: input.sourceType,
          sourceDocNo: input.sourceDocNo,
          materialCode: lot.materialCode,
          materialName: material?.name ?? lot.materialCode,
          originalQty: lot.qty,
          qty: lot.qty,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          responsible: input.responsible,
          workOrderId: input.workOrderId ?? null,
          warehouseCode: lot.warehouseCode,
          originLocation: lot.locationCode,
          status: SurplusStatus.OPEN,
          createdBy: operator,
        }),
      );
      await this.audit.log({
        operator,
        action: 'surplus.register',
        docNo,
        after: record,
        result: 'SUCCESS',
      });
      return record;
    });
  }

  /** prep leftoverReminder 场景：从发料剩余直接登记入 YL */
  async registerFromLeftover(input: {
    packageNo: string;
    prepDocNo: string;
    responsible: string;
    workOrderId?: string;
    occurredAt?: string;
    requestId: string;
    operator: string;
  }): Promise<SurplusRecord> {
    return this.register({
      packageNo: input.packageNo,
      sourceType: SurplusSourceType.PREP_LEFTOVER,
      sourceDocNo: input.prepDocNo,
      responsible: input.responsible,
      workOrderId: input.workOrderId,
      occurredAt: input.occurredAt,
      requestId: input.requestId,
      operator: input.operator,
    });
  }

  /** 生成到期提醒（幂等：同一 (surplusId, remindDay) 只生成一次） */
  async scanReminders(now: Date = new Date()): Promise<SurplusReminder[]> {
    const days = await this.remindDays();
    const openRecords = await this.recordRepo.find({ where: { status: SurplusStatus.OPEN } });
    const created: SurplusReminder[] = [];
    for (const rec of openRecords) {
      const elapsed = Math.floor((now.getTime() - new Date(rec.occurredAt).getTime()) / 86400000);
      for (const d of days) {
        if (elapsed < d) continue;
        const dup = await this.reminderRepo.findOne({
          where: { surplusId: rec.id, remindDay: d },
        });
        if (dup) continue;
        const count = await this.reminderRepo.count({ where: { surplusId: rec.id } });
        created.push(
          await this.reminderRepo.save(
            this.reminderRepo.create({
              surplusId: rec.id,
              docNo: rec.docNo,
              remindCount: count + 1,
              remindDay: d,
              targetRole: rec.workOrderId ? 'PMC' : 'WH_MANAGER',
              targetRef: rec.workOrderId ?? null,
              status: ReminderStatus.PENDING,
            }),
          ),
        );
      }
    }
    return created;
  }

  reminders(status?: ReminderStatus) {
    return this.reminderRepo.find({
      where: status ? { status } : {},
      order: { id: 'DESC' },
    });
  }

  /** 处理余料（三选一）：按实际处理数递减，余额为 0 才关闭，部分处理保留提醒 */
  async process(id: number, input: ProcessSurplusInput): Promise<{ record: SurplusRecord; process: SurplusProcess }> {
    return this.idem.execute(input.requestId, 'surplus.process', async () => {
      const rec = await this.mustGetRecord(id);
      if (rec.status !== SurplusStatus.OPEN) {
        throw new BizException('SURPLUS_CLOSED', `Surplus ${rec.docNo} is closed`);
      }
      if (!Object.values(SurplusProcessMethod).includes(input.method)) {
        throw new BizException('INVALID_METHOD', `Unknown method: ${input.method}`);
      }
      if (input.qty <= 0 || input.qty > rec.qty) {
        throw new BizException(
          'SURPLUS_QTY_EXCEED',
          `Process qty ${input.qty} exceeds remaining ${rec.qty}`,
        );
      }
      const docNo = await this.numbering.next('SUR');
      const lot = await this.mustGetLot(rec.packageNo);
      let relatedDocNo: string | null = null;

      if (input.method === SurplusProcessMethod.RETURN_SUPPLIER) {
        // 红字方向：只扣减 YL 余料批次，正常库存不得反向增加；退货单走 SyncService 同步 U8
        await this.inv.adjust(rec.packageNo, lot.qty - input.qty, '余料退供应商', docNo, `${input.requestId}:adjust`, input.operator);
        await this.sync.enqueue({
          bizType: 'surplus',
          bizKey: docNo,
          voucherType: 'RETURN_SUPPLIER',
          payload: {
            docNo,
            surplusDocNo: rec.docNo,
            materialCode: rec.materialCode,
            qty: input.qty,
            sourceDocNo: rec.sourceDocNo,
          },
        });
        relatedDocNo = docNo;
      } else {
        // REUSE_ORDER / CROSS_TRANSFER：YL 调出 → 新批次 QUALIFIED 回原库位 + 关联新工单占用
        if (!input.targetWorkOrderId) {
          throw new BizException('TARGET_WO_REQUIRED', 'targetWorkOrderId is required for REUSE_ORDER/CROSS_TRANSFER');
        }
        const newPackageNo = `${docNo}-PKG`;
        await this.inv.adjust(rec.packageNo, lot.qty - input.qty, '余料调出', docNo, `${input.requestId}:adjust`, input.operator);
        await this.inv.inbound({
          packageNo: newPackageNo,
          materialCode: rec.materialCode,
          batchNo: lot.batchNo,
          qty: input.qty,
          warehouseCode: rec.warehouseCode,
          locationCode: rec.originLocation,
          status: StockStatus.QUALIFIED,
          workOrderId: input.targetWorkOrderId,
          sourceDocNo: docNo,
          requestId: `${input.requestId}:inbound`,
          operator: input.operator,
        });
        await this.inv.occupy(
          input.targetWorkOrderId,
          [{ materialCode: rec.materialCode, qty: input.qty }],
          docNo,
          `${input.requestId}:occupy`,
          input.operator,
        );
        relatedDocNo = newPackageNo;
      }

      const proc = await this.processRepo.save(
        this.processRepo.create({
          docNo,
          surplusId: rec.id,
          surplusDocNo: rec.docNo,
          method: input.method,
          qty: input.qty,
          targetWorkOrderId: input.targetWorkOrderId ?? null,
          relatedDocNo,
          operator: input.operator,
        }),
      );

      const before = { qty: rec.qty, status: rec.status };
      rec.qty = Number((rec.qty - input.qty).toFixed(6));
      if (rec.qty <= 0) {
        rec.qty = 0;
        rec.status = SurplusStatus.CLOSED;
        // 关闭后待办提醒一并完结；部分处理（未关闭）保留提醒
        await this.reminderRepo.update(
          { surplusId: rec.id, status: ReminderStatus.PENDING },
          { status: ReminderStatus.DONE },
        );
      }
      const saved = await this.recordRepo.save(rec);

      await this.audit.log({
        operator: input.operator,
        action: 'surplus.process',
        docNo,
        before,
        after: { qty: saved.qty, status: saved.status, method: input.method },
        result: 'SUCCESS',
      });
      return { record: saved, process: proc };
    });
  }

  /** 标签打印/补打：模板来自 RuleConfig surplus.labelTemplate（JSON fields 数组），留痕 */
  async print(id: number, operator: string): Promise<{ docNo: string; printType: string; label: Record<string, unknown> }> {
    const rec = await this.mustGetRecord(id);
    const fields = await this.labelFields();
    const label: Record<string, unknown> = {};
    for (const f of fields) label[f] = (rec as any)[f] ?? null;

    const printed = await this.printRepo.count({ where: { surplusId: rec.id } });
    const printType = printed > 0 ? 'REPRINT' : 'PRINT';
    await this.printRepo.save(
      this.printRepo.create({ surplusId: rec.id, docNo: rec.docNo, printType, operator }),
    );
    await this.audit.log({
      operator,
      action: 'surplus.print',
      docNo: rec.docNo,
      after: { printType, label },
      result: 'SUCCESS',
    });
    return { docNo: rec.docNo, printType, label };
  }

  list(status?: SurplusStatus) {
    return this.recordRepo.find({
      where: status ? { status } : {},
      order: { id: 'DESC' },
    });
  }

  detail(id: number) {
    return this.mustGetRecord(id);
  }

  // ---------- internals ----------

  private async mustGetRecord(id: number): Promise<SurplusRecord> {
    const rec = await this.recordRepo.findOne({ where: { id } });
    if (!rec) throw new BizException('SURPLUS_NOT_FOUND', `Surplus ${id} not found`, 404);
    return rec;
  }

  private async mustGetLot(packageNo: string): Promise<StockLot> {
    const lot = await this.lotRepo.findOne({ where: { packageNo } });
    if (!lot) throw new BizException('LOT_NOT_FOUND', `packageNo ${packageNo} not found`, 404);
    return lot;
  }

  private async mustGetYlLocation(): Promise<Location> {
    const loc = await this.locationRepo.findOne({ where: { areaCode: YL_AREA_CODE } });
    if (!loc) throw new BizException('YL_LOCATION_MISSING', `No location with areaCode ${YL_AREA_CODE}`);
    return loc;
  }

  private async remindDays(): Promise<number[]> {
    const raw = await this.ruleConfig.get('surplus.remindDays');
    if (!raw) return DEFAULT_REMIND_DAYS;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr.map(Number).sort((a, b) => a - b) : DEFAULT_REMIND_DAYS;
    } catch {
      return DEFAULT_REMIND_DAYS;
    }
  }

  private async labelFields(): Promise<string[]> {
    const raw = await this.ruleConfig.get('surplus.labelTemplate');
    if (!raw) return DEFAULT_LABEL_FIELDS;
    try {
      const tpl = JSON.parse(raw);
      const fields = Array.isArray(tpl) ? tpl : tpl?.fields;
      return Array.isArray(fields) && fields.length ? fields : DEFAULT_LABEL_FIELDS;
    } catch {
      return DEFAULT_LABEL_FIELDS;
    }
  }
}
