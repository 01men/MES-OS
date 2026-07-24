import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AbcClass, ApprovalStatus, StockStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { NumberingService } from '../../common/numbering/numbering.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { RuleConfigService } from '../config/rule-config.service';
import { InventoryService } from '../inventory/inventory.service';
import { SyncService } from '../integration/sync.service';
import { U8Adapter } from '../integration/u8-adapter';
import { Material } from '../masterdata/entities/material.entity';
import {
  PoOrderType,
  RcvPurchaseOrder,
  RcvPurchaseOrderLine,
} from './entities/purchase-order.entity';
import {
  ArrivalStatus,
  CountMode,
  InboundPosting,
  IqcDecision,
  ReceivingArrival,
} from './entities/receiving-arrival.entity';
import { LabelPrintLog } from './entities/label-print-log.entity';
import { NcrReport } from './entities/ncr-report.entity';

export interface ScanInput {
  barcode?: string;
}

export interface CreateArrivalInput {
  poNo: string;
  materialCode: string;
  qty: number;
  scannedQty?: number;
  labelQty?: number;
  warehouseCode: string;
  locationCode: string;
  batchTime?: string;
  workOrderId?: string;
  /** 超订单容差内收货所需的已批准审批单 ID */
  overApprovalId?: number;
}

export interface IqcInput {
  decision: IqcDecision;
  qualifiedQty?: number;
  rejectedQty?: number;
  concessionQty?: number;
  pendingQty?: number;
  defectDescription?: string;
}

export interface ConfirmInput {
  /** MANUAL_REVIEW 清点方式下的人工复核确认标记 */
  manualReview?: boolean;
}

/** 最小包装条码：PO号|料号|数量|供应商编码|批次时间(YYYYMMDD) */
export interface ParsedBarcode {
  poNo: string;
  materialCode: string;
  qty: number;
  supplierCode: string;
  batchTime: string;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 来料链接收服务：到货暂存 → 送检 → IQC 判定 → 合格入库/隔离。
 * REQ-001 最小包装条码/批次规则/标签；REQ-003 ABC 清点；
 * REQ-002 部分接收/特采 MRB 会签 + NCR；REQ-004 委外入库；采购订单 U8 同步。
 */
@Injectable()
export class ReceivingService {
  constructor(
    @InjectRepository(RcvPurchaseOrder)
    private readonly poRepo: Repository<RcvPurchaseOrder>,
    @InjectRepository(RcvPurchaseOrderLine)
    private readonly lineRepo: Repository<RcvPurchaseOrderLine>,
    @InjectRepository(ReceivingArrival)
    private readonly arrivalRepo: Repository<ReceivingArrival>,
    @InjectRepository(LabelPrintLog)
    private readonly labelRepo: Repository<LabelPrintLog>,
    @InjectRepository(NcrReport)
    private readonly ncrRepo: Repository<NcrReport>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly numbering: NumberingService,
    private readonly idem: IdempotencyService,
    private readonly audit: AuditService,
    private readonly approval: ApprovalEngineService,
    private readonly ruleConfig: RuleConfigService,
    private readonly inventory: InventoryService,
    private readonly sync: SyncService,
    private readonly u8: U8Adapter,
  ) {}

  // ---------- 采购订单同步（REQ 采购订单同步：重复拉取幂等） ----------

  async syncPurchaseOrders(since?: string, operator = 'system') {
    const rows = await this.u8.fetchPurchaseOrders(since);
    let synced = 0;
    for (const row of rows ?? []) {
      await this.ds.transaction(async (em) => {
        const poRepo = em.getRepository(RcvPurchaseOrder);
        const lineRepo = em.getRepository(RcvPurchaseOrderLine);
        let po = await poRepo.findOne({ where: { poNo: row.poNo } });
        if (!po) {
          po = poRepo.create({
            poNo: row.poNo,
            supplierCode: row.supplierCode,
            orderType: row.orderType ?? PoOrderType.NORMAL,
            status: row.status ?? 'OPEN',
            sourceUpdatedAt: row.updatedAt ?? null,
          });
        } else {
          // 已存在的订单不允许改动关键字段，仅刷新状态与源时间（幂等重拉）
          po.status = row.status ?? po.status;
          po.sourceUpdatedAt = row.updatedAt ?? po.sourceUpdatedAt;
        }
        await poRepo.save(po);
        for (const line of row.lines ?? []) {
          const existing = await lineRepo.findOne({
            where: { poNo: row.poNo, materialCode: line.materialCode },
          });
          if (existing) continue; // 已收数量等本地状态不覆盖
          await lineRepo.save(
            lineRepo.create({
              poNo: row.poNo,
              materialCode: line.materialCode,
              qty: line.qty,
              receivedQty: 0,
              unit: line.unit ?? 'PCS',
            }),
          );
        }
      });
      synced += 1;
    }
    await this.audit.log({
      operator,
      action: 'receiving.po.sync',
      after: { since, synced },
      result: 'SUCCESS',
    });
    return { synced };
  }

  async listOrders() {
    const pos = await this.poRepo.find({ order: { createdAt: 'DESC' } });
    const lines = await this.lineRepo.find();
    return pos.map((po) => ({
      ...po,
      lines: lines.filter((l) => l.poNo === po.poNo),
    }));
  }

  // ---------- REQ-001 扫码解析 + REQ-003 ABC 清点提示 ----------

  parseBarcode(barcode: string): ParsedBarcode {
    const parts = String(barcode ?? '').split('|');
    if (parts.length < 5) {
      throw new BizException(
        'BARCODE_INVALID',
        '条码格式应为 PO号|料号|数量|供应商编码|批次时间(YYYYMMDD)',
      );
    }
    const [poNo, materialCode, qtyRaw, supplierCode, batchTime] = parts;
    const qty = Number(qtyRaw);
    if (!poNo || !materialCode || !supplierCode || !(qty > 0)) {
      throw new BizException('BARCODE_INVALID', `条码字段非法: ${barcode}`);
    }
    return { poNo, materialCode, qty, supplierCode, batchTime };
  }

  /** 扫码：返回采购订单 + 物料 + ABC 清点策略提示 */
  async scan(input: ScanInput) {
    if (!input.barcode) throw new BizException('BARCODE_REQUIRED', 'barcode is required');
    const parsed = this.parseBarcode(input.barcode);
    const { po, line } = await this.mustGetOpenPoLine(parsed.poNo, parsed.materialCode);
    const material = await this.mustGetMaterial(parsed.materialCode);
    const abc = await this.resolveAbcPolicy(material);
    return {
      ...parsed,
      materialName: material.name,
      unit: line.unit,
      orderType: po.orderType,
      isOutsource: po.orderType === PoOrderType.OUTSOURCE,
      orderQty: line.qty,
      receivedQty: line.receivedQty,
      remainingQty: line.qty - line.receivedQty,
      abcClass: material.abcClass,
      countMode: abc.mode,
      countHint: abc.hint,
    };
  }

  /** 依据物料 ABC 分类得出清点方式与提示（UNSET 待分类按 A 类严格策略） */
  private async resolveAbcPolicy(material: Material) {
    const cls = material.abcClass ?? AbcClass.UNSET;
    if (cls === AbcClass.A || cls === AbcClass.UNSET) {
      return {
        mode: CountMode.FULL,
        hint: cls === AbcClass.UNSET
          ? '待分类物料按 A 类严格策略：全点，扫码数须等于订单数才允许确认'
          : 'A 类物料：全点，扫码数须等于订单数才允许确认',
      };
    }
    if (cls === AbcClass.B) {
      const rate = Number((await this.ruleConfig.get('abc.sampleRate')) ?? '0.2');
      return {
        mode: CountMode.SAMPLE,
        hint: `B 类物料：按 ${Math.round(rate * 100)}% 比例抽查，出现差异自动转全点`,
      };
    }
    const tol = Number((await this.ruleConfig.get('abc.tolerance')) ?? '0.01');
    return {
      mode: CountMode.LABEL,
      hint: `C 类物料：按标签计数，数量差异超过 ${(tol * 100).toFixed(1)}% 转人工复核`,
    };
  }

  // ---------- 第一步：创建到货暂存单 ----------

  async createArrival(input: CreateArrivalInput, requestId: string, operator: string) {
    return this.idem.execute(requestId, 'receiving.arrival', async () => {
      const { po, line } = await this.mustGetOpenPoLine(input.poNo, input.materialCode);
      const material = await this.mustGetMaterial(input.materialCode);
      const qty = Number(input.qty);
      if (!(qty > 0)) throw new BizException('INVALID_QTY', 'qty must be > 0');

      // 剩余可收数量 + 超订单容差审批
      const remaining = line.qty - line.receivedQty;
      if (qty > remaining) {
        const tol = Number((await this.ruleConfig.get('receiving.overTolerance')) ?? '0.05');
        if (qty > remaining * (1 + tol)) {
          throw new BizException(
            'OVER_ORDER_QTY',
            `到货 ${qty} 超出订单剩余 ${remaining} 的容差 ${(tol * 100).toFixed(1)}%`,
          );
        }
        if (!input.overApprovalId) {
          throw new BizException('OVER_ORDER_APPROVAL_REQUIRED', '超订单收货需提供已批准的审批单 overApprovalId');
        }
        const ap = await this.approval.get(input.overApprovalId);
        if (ap.status !== ApprovalStatus.APPROVED) {
          throw new BizException('OVER_ORDER_APPROVAL_REQUIRED', `超订单审批单 ${ap.id} 状态 ${ap.status}`);
        }
      }

      // ABC 清点方式落单（B 类差异自动转全点；C 类超容差转人工复核）
      const abc = await this.resolveAbcPolicy(material);
      let countMode = abc.mode;
      const scannedQty = Number(input.scannedQty ?? 0);
      if (countMode === CountMode.SAMPLE && input.labelQty != null && scannedQty !== Number(input.labelQty)) {
        countMode = CountMode.FULL; // 抽查出现差异 → 自动转全点
      }
      if (countMode === CountMode.LABEL && input.labelQty != null && qty > 0) {
        const tol = Number((await this.ruleConfig.get('abc.tolerance')) ?? '0.01');
        if (Math.abs(Number(input.labelQty) - qty) / qty > tol) {
          countMode = CountMode.MANUAL_REVIEW;
        }
      }

      const arrivalNo = await this.numbering.next('RCV');
      const packageNo = await this.numbering.next('PKG');
      const batchNo = await this.nextBatchNo(po.supplierCode);

      const arrival = await this.arrivalRepo.save(
        this.arrivalRepo.create({
          arrivalNo,
          poNo: po.poNo,
          materialCode: input.materialCode,
          qty,
          scannedQty,
          labelQty: input.labelQty != null ? Number(input.labelQty) : null,
          orderQty: line.qty,
          supplierCode: po.supplierCode,
          batchNo,
          batchTime: input.batchTime ?? null,
          packageNo,
          warehouseCode: input.warehouseCode,
          locationCode: input.locationCode,
          abcClass: material.abcClass ?? AbcClass.UNSET,
          countMode,
          status: ArrivalStatus.ARRIVED,
          isOutsource: po.orderType === PoOrderType.OUTSOURCE,
          workOrderId: input.workOrderId ?? null,
          printCount: 1,
        }),
      );
      await this.labelRepo.save(
        this.labelRepo.create({
          packageNo,
          arrivalNo,
          printType: 'INITIAL',
          reason: null,
          printSeq: 1,
          printedBy: operator,
        }),
      );
      await this.audit.log({
        operator,
        action: 'receiving.arrival',
        docNo: arrivalNo,
        after: arrival,
        result: 'SUCCESS',
      });
      return {
        ...arrival,
        label: this.buildLabel(arrival, material),
        countHint: abc.hint,
      };
    });
  }

  /** 标签内容：包装号+采购订单号+物料编码+批次号+数量+单位 */
  private buildLabel(arrival: ReceivingArrival, material: Material) {
    return {
      packageNo: arrival.packageNo,
      poNo: arrival.poNo,
      materialCode: arrival.materialCode,
      batchNo: arrival.batchNo,
      qty: arrival.qty,
      unit: material.unit,
    };
  }

  /** 批次号：RuleConfig receiving.batchRule 模板（{date}/{supplier}/{seq}），默认 LOT-YYYYMMDD-供应商编码-四位流水 */
  private async nextBatchNo(supplierCode: string, date = new Date()): Promise<string> {
    const tpl = (await this.ruleConfig.get('receiving.batchRule')) ?? 'LOT-{date}-{supplier}-{seq}';
    const raw = await this.numbering.next(`LOT${supplierCode}`, date);
    const seq = raw.slice(-4);
    return tpl
      .replace('{date}', fmtDate(date))
      .replace('{supplier}', supplierCode)
      .replace('{seq}', seq);
  }

  // ---------- 第二步：送检 ----------

  async sendInspect(id: number, requestId: string, operator: string) {
    return this.idem.execute(requestId, 'receiving.sendInspect', async () => {
      const arrival = await this.mustGetArrival(id);
      if (arrival.status !== ArrivalStatus.ARRIVED) {
        throw new BizException('INVALID_STATUS', `到货单 ${arrival.arrivalNo} 状态 ${arrival.status}，不能送检`);
      }
      const before = { ...arrival };
      arrival.status = ArrivalStatus.INSPECTING;
      const saved = await this.arrivalRepo.save(arrival);
      await this.audit.log({
        operator,
        action: 'receiving.sendInspect',
        docNo: arrival.arrivalNo,
        before,
        after: saved,
        result: 'SUCCESS',
      });
      return saved;
    });
  }

  // ---------- 第三步：IQC 判定（REQ-002 全部/部分/特采 + 数量守恒 + NCR + MRB 会签） ----------

  async submitIqc(id: number, input: IqcInput, requestId: string, operator: string) {
    return this.idem.execute(requestId, 'receiving.iqc', async () => {
      const arrival = await this.mustGetArrival(id);
      if (arrival.status !== ArrivalStatus.INSPECTING) {
        throw new BizException('INVALID_STATUS', `到货单 ${arrival.arrivalNo} 状态 ${arrival.status}，不能提交 IQC 判定`);
      }
      if (!Object.values(IqcDecision).includes(input.decision)) {
        throw new BizException('DECISION_INVALID', `未知 IQC 判定: ${input.decision}`);
      }
      const q = Number(input.qualifiedQty ?? 0);
      const r = Number(input.rejectedQty ?? 0);
      const c = Number(input.concessionQty ?? 0);
      const p = Number(input.pendingQty ?? 0);
      for (const [name, v] of Object.entries({ qualifiedQty: q, rejectedQty: r, concessionQty: c, pendingQty: p })) {
        if (v < 0) throw new BizException('INVALID_QTY', `${name} must be >= 0`);
      }
      // 数量守恒：来料 = 合格 + 不合格 + 特采 + 待处理
      if (Math.abs(q + r + c + p - arrival.qty) > 1e-9) {
        throw new BizException(
          'QTY_NOT_CONSERVED',
          `数量不守恒：合格${q}+不合格${r}+特采${c}+待处理${p} ≠ 到货${arrival.qty}`,
        );
      }
      if (input.decision === IqcDecision.ALL && (r > 0 || c > 0 || p > 0)) {
        throw new BizException('DECISION_MISMATCH', '全部接收时不合格/特采/待处理数量必须为 0');
      }
      if (input.decision === IqcDecision.CONCESSION && c <= 0) {
        throw new BizException('DECISION_MISMATCH', '特采判定必须给出特采数量 concessionQty');
      }
      if ((r > 0 || c > 0) && !input.defectDescription) {
        throw new BizException('DEFECT_DESC_REQUIRED', '存在不合格/特采数量时缺陷描述必填');
      }

      const before = { ...arrival };
      arrival.iqcDecision = input.decision;
      arrival.qualifiedQty = q;
      arrival.rejectedQty = r;
      arrival.concessionQty = c;
      arrival.pendingQty = p;
      arrival.defectDescription = input.defectDescription ?? null;

      // 电子不合格报告：存在不合格或特采数量时自动生成
      let ncr: NcrReport | null = null;
      if (r > 0 || c > 0) {
        ncr = await this.ncrRepo.save(
          this.ncrRepo.create({
            ncrNo: await this.numbering.next('NCR'),
            arrivalNo: arrival.arrivalNo,
            batchNo: arrival.batchNo,
            materialCode: arrival.materialCode,
            qty: r + c,
            defectDescription: input.defectDescription!,
            notifyRoles: 'IQC,MRB',
            status: 'OPEN',
          }),
        );
      }

      // 特采必须走 MRB 电子会签（质量负责人 + 授权管理人员，引擎保证禁止自审）
      let approvalId: number | null = null;
      if (c > 0) {
        const ap = await this.approval.create('CONCESSION', arrival.arrivalNo, operator, [
          { approverRole: 'QE' },
          { approverRole: 'WH_MANAGER' },
        ]);
        approvalId = ap.id;
      }
      arrival.approvalId = approvalId;
      arrival.status = ArrivalStatus.INSPECTED;
      const saved = await this.arrivalRepo.save(arrival);
      await this.audit.log({
        operator,
        action: 'receiving.iqc',
        docNo: arrival.arrivalNo,
        before,
        after: { ...saved, ncrNo: ncr?.ncrNo ?? null, approvalId },
        result: 'SUCCESS',
      });
      return { ...saved, ncrReport: ncr, approvalId };
    });
  }

  // ---------- 确认入库/隔离（合格→QUALIFIED；不合格→ISOLATED；入队同步 U8） ----------

  async confirm(id: number, input: ConfirmInput, requestId: string, operator: string) {
    return this.idem.execute(requestId, 'receiving.confirm', async () => {
      const arrival = await this.mustGetArrival(id);
      if (arrival.status !== ArrivalStatus.INSPECTED) {
        throw new BizException('INVALID_STATUS', `到货单 ${arrival.arrivalNo} 状态 ${arrival.status}，不能确认入库`);
      }
      const q = arrival.qualifiedQty ?? 0;
      const r = arrival.rejectedQty ?? 0;
      const c = arrival.concessionQty ?? 0;
      const p = arrival.pendingQty ?? 0;
      if (p > 0) {
        throw new BizException('PENDING_QTY_REMAIN', `仍有待处理数量 ${p}，须先完成判定`);
      }
      if (Math.abs(q + r + c - arrival.qty) > 1e-9) {
        throw new BizException('QTY_NOT_CONSERVED', 'IQC 数量明细与到货数量不守恒');
      }

      // ABC 清点门槛：全点物料扫码数须等于订单数；超容差须人工复核
      if (arrival.countMode === CountMode.FULL && arrival.scannedQty < arrival.orderQty) {
        throw new BizException(
          'ABC_COUNT_INCOMPLETE',
          `全点物料扫码数 ${arrival.scannedQty} 未达订单数 ${arrival.orderQty}，不允许确认`,
        );
      }
      if (arrival.countMode === CountMode.MANUAL_REVIEW && input?.manualReview !== true) {
        throw new BizException('MANUAL_REVIEW_REQUIRED', '标签计数超容差，须人工复核（manualReview=true）后方可确认');
      }

      // 特采：无 MRB 会签批准不允许入库过账
      if (c > 0) {
        if (!arrival.approvalId) {
          throw new BizException('CONCESSION_APPROVAL_REQUIRED', '特采缺少 MRB 会签审批单');
        }
        const ap = await this.approval.get(arrival.approvalId);
        if (ap.status !== ApprovalStatus.APPROVED) {
          throw new BizException(
            'CONCESSION_APPROVAL_REQUIRED',
            `特采 MRB 会签未通过（审批单 ${ap.id} 状态 ${ap.status}），不允许入库过账`,
          );
        }
      }

      const before = { ...arrival };
      const postings: InboundPosting[] = [];
      const basePosting = {
        isOutsource: arrival.isOutsource,
        sourcePoNo: arrival.poNo,
        supplierCode: arrival.supplierCode,
      };
      // 合格（含非特采）→ QUALIFIED，复用到货包装号
      if (q > 0) {
        const lot = await this.inventory.inbound({
          packageNo: arrival.packageNo,
          materialCode: arrival.materialCode,
          batchNo: arrival.batchNo,
          qty: q,
          warehouseCode: arrival.warehouseCode,
          locationCode: arrival.locationCode,
          status: StockStatus.QUALIFIED,
          workOrderId: arrival.workOrderId ?? undefined,
          sourceDocNo: arrival.arrivalNo,
          requestId: `${requestId}:post:q`,
          operator,
        });
        postings.push({ packageNo: lot.packageNo, qty: q, status: 'QUALIFIED', concession: false, ...basePosting });
      }
      // 特采 → QUALIFIED 但打 concession 标（独立包装号）
      if (c > 0) {
        const pkg = await this.numbering.next('PKG');
        const lot = await this.inventory.inbound({
          packageNo: pkg,
          materialCode: arrival.materialCode,
          batchNo: arrival.batchNo,
          qty: c,
          warehouseCode: arrival.warehouseCode,
          locationCode: arrival.locationCode,
          status: StockStatus.QUALIFIED,
          workOrderId: arrival.workOrderId ?? undefined,
          sourceDocNo: arrival.arrivalNo,
          requestId: `${requestId}:post:c`,
          operator,
        });
        postings.push({ packageNo: lot.packageNo, qty: c, status: 'QUALIFIED', concession: true, ...basePosting });
      }
      // 不合格 → ISOLATED（独立包装号）
      if (r > 0) {
        const pkg = await this.numbering.next('PKG');
        const lot = await this.inventory.inbound({
          packageNo: pkg,
          materialCode: arrival.materialCode,
          batchNo: arrival.batchNo,
          qty: r,
          warehouseCode: arrival.warehouseCode,
          locationCode: arrival.locationCode,
          status: StockStatus.ISOLATED,
          sourceDocNo: arrival.arrivalNo,
          requestId: `${requestId}:post:r`,
          operator,
        });
        postings.push({ packageNo: lot.packageNo, qty: r, status: 'ISOLATED', concession: false, ...basePosting });
      }

      // 累加订单行已收数量
      await this.lineRepo.increment({ poNo: arrival.poNo, materialCode: arrival.materialCode }, 'receivedQty', arrival.qty);

      // 入库单入队同步 U8（PENDING_SYNC→SYNCED/SYNC_ERROR）
      const task = await this.sync.enqueue({
        bizType: 'receiving',
        bizKey: arrival.arrivalNo,
        voucherType: 'RECEIVE',
        payload: {
          arrivalNo: arrival.arrivalNo,
          poNo: arrival.poNo,
          materialCode: arrival.materialCode,
          batchNo: arrival.batchNo,
          supplierCode: arrival.supplierCode,
          isOutsource: arrival.isOutsource,
          postings,
        },
      });

      arrival.status = ArrivalStatus.CONFIRMED;
      arrival.postings = JSON.stringify(postings);
      arrival.syncStatus = task.status;
      const saved = await this.arrivalRepo.save(arrival);
      await this.audit.log({
        operator,
        action: 'receiving.confirm',
        docNo: arrival.arrivalNo,
        before,
        after: { ...saved, syncTaskId: task.id },
        result: 'SUCCESS',
      });
      return {
        ...saved,
        postings,
        syncTask: task,
        // 委外入库后若已分配工单 → 工序发料提醒
        workOrderIssueReminder: arrival.isOutsource && !!arrival.workOrderId,
      };
    });
  }

  // ---------- 查询 ----------

  async listArrivals(status?: ArrivalStatus) {
    const where = status ? { status } : {};
    return this.arrivalRepo.find({ where, order: { id: 'DESC' } });
  }

  async getArrival(id: number) {
    const arrival = await this.mustGetArrival(id);
    const labelLogs = await this.labelRepo.find({
      where: { arrivalNo: arrival.arrivalNo },
      order: { id: 'ASC' },
    });
    const ncrReports = await this.ncrRepo.find({ where: { arrivalNo: arrival.arrivalNo } });
    return {
      ...arrival,
      postings: arrival.postings ? JSON.parse(arrival.postings) : [],
      labelLogs,
      ncrReports,
    };
  }

  // ---------- REQ-001 补打（原因必填，记日志） ----------

  async reprintLabel(packageNo: string, reason: string | undefined, requestId: string, operator: string) {
    if (!reason) throw new BizException('REPRINT_REASON_REQUIRED', '补打原因必填');
    return this.idem.execute(requestId, 'receiving.label.reprint', async () => {
      const arrival = await this.arrivalRepo.findOne({ where: { packageNo } });
      if (!arrival) throw new BizException('PACKAGE_NOT_FOUND', `包装号 ${packageNo} 不存在`, 404);
      arrival.printCount += 1;
      const saved = await this.arrivalRepo.save(arrival);
      const log = await this.labelRepo.save(
        this.labelRepo.create({
          packageNo,
          arrivalNo: arrival.arrivalNo,
          printType: 'REPRINT',
          reason,
          printSeq: saved.printCount,
          printedBy: operator,
        }),
      );
      await this.audit.log({
        operator,
        action: 'receiving.label.reprint',
        docNo: arrival.arrivalNo,
        after: { packageNo, reason, printCount: saved.printCount },
        result: 'SUCCESS',
      });
      return { packageNo, printCount: saved.printCount, log };
    });
  }

  // ---------- internals ----------

  private async mustGetArrival(id: number): Promise<ReceivingArrival> {
    const arrival = await this.arrivalRepo.findOne({ where: { id } });
    if (!arrival) throw new BizException('ARRIVAL_NOT_FOUND', `到货单 ${id} 不存在`, 404);
    return arrival;
  }

  private async mustGetMaterial(materialCode: string): Promise<Material> {
    const material = await this.materialRepo.findOne({ where: { materialCode } });
    if (!material) throw new BizException('MATERIAL_NOT_FOUND', `物料 ${materialCode} 不存在`, 404);
    return material;
  }

  /** 校验采购订单存在、未关闭、订单行存在 */
  private async mustGetOpenPoLine(poNo: string, materialCode: string) {
    const po = await this.poRepo.findOne({ where: { poNo } });
    if (!po) throw new BizException('PO_NOT_FOUND', `采购订单 ${poNo} 不存在（请先从 U8 同步）`, 404);
    if (po.status === 'CLOSED') throw new BizException('PO_CLOSED', `采购订单 ${poNo} 已关闭`);
    const line = await this.lineRepo.findOne({ where: { poNo, materialCode } });
    if (!line) throw new BizException('PO_LINE_NOT_FOUND', `采购订单 ${poNo} 无物料 ${materialCode} 行`);
    return { po, line };
  }
}
