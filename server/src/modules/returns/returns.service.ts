import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApprovalStatus,
  DocStatus,
  OccupationStatus,
  StockStatus,
} from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { InventoryService } from '../inventory/inventory.service';
import { SyncService } from '../integration/sync.service';
import { RuleConfigService } from '../config/rule-config.service';
import { StockOccupation } from '../inventory/entities/stock-occupation.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { Material } from '../masterdata/entities/material.entity';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Bom } from '../masterdata/entities/bom.entity';
import { Location } from '../masterdata/entities/location.entity';
import { DefectRecord, DefectStatus } from './entities/defect-record.entity';
import { ReturnOrder, ReturnStatus, ReturnType } from './entities/return-order.entity';
import {
  ReplenishOrder,
  ReplenishStatus,
  ReplenishType,
} from './entities/replenish-order.entity';
import {
  WriteoffOrder,
  WriteoffReason,
  WriteoffStatus,
} from './entities/writeoff-order.entity';
import { QualityTransfer, QTransferStatus } from './entities/quality-transfer.entity';

/** 超退审批角色：仓库主管 */
const OVER_RETURN_APPROVER_ROLE = 'WH_MANAGER';
/** 超领审批角色：车间主任 */
const OVER_ISSUE_APPROVER_ROLE = 'WORKSHOP_DIRECTOR';
/** 不良记录 / 不良调回良品审批角色：质量工程师 */
const QE_ROLE = 'QE';
/** 损耗核销双审批：质量工程师 + 财务（两步都过才 APPROVED，任一拒绝即 REJECTED） */
const WRITEOFF_STEPS = [{ approverRole: QE_ROLE }, { approverRole: 'FINANCE' }];
/** 良/不良调拨电子签角色：质检员或质量工程师 */
const QUALITY_SIGN_ROLES = ['INSPECTOR', QE_ROLE];

/**
 * 退补料 / 损耗 / 良不良调拨（REQ-015~017、021 + 纪要）。
 * 超领超退单据独立编号（OVR 前缀）、单独统计、不计入正常损耗。
 */
@Injectable()
export class ReturnsService {
  constructor(
    @InjectRepository(DefectRecord)
    private readonly defectRepo: Repository<DefectRecord>,
    @InjectRepository(ReturnOrder)
    private readonly returnRepo: Repository<ReturnOrder>,
    @InjectRepository(ReplenishOrder)
    private readonly replenishRepo: Repository<ReplenishOrder>,
    @InjectRepository(WriteoffOrder)
    private readonly writeoffRepo: Repository<WriteoffOrder>,
    @InjectRepository(QualityTransfer)
    private readonly qtRepo: Repository<QualityTransfer>,
    @InjectRepository(StockOccupation)
    private readonly occRepo: Repository<StockOccupation>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectRepository(WorkOrder)
    private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(Bom)
    private readonly bomRepo: Repository<Bom>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
    private readonly inv: InventoryService,
    private readonly sync: SyncService,
    private readonly approval: ApprovalEngineService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idem: IdempotencyService,
    private readonly ruleConfig: RuleConfigService,
  ) {}

  // ---------- 不良品处理记录 ----------

  /** 登记不良品处理记录（QE 审批后才可作为不良退料依据） */
  async createDefect(input: {
    workOrderId: string;
    materialCode: string;
    qty: number;
    reason: string;
    requestId: string;
    operator: string;
  }): Promise<DefectRecord> {
    return this.idem.execute(input.requestId, 'returns.defectCreate', async () => {
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');
      const docNo = await this.numbering.next('DEF');
      const ap = await this.approval.create('defect', docNo, input.operator, [
        { approverRole: QE_ROLE },
      ]);
      const rec = await this.defectRepo.save(
        this.defectRepo.create({
          docNo,
          workOrderId: input.workOrderId,
          materialCode: input.materialCode,
          qty: input.qty,
          reason: input.reason,
          approvalId: ap.id,
          status: DefectStatus.PENDING_APPROVAL,
          createdBy: input.operator,
        }),
      );
      await this.audit.log({ operator: input.operator, action: 'returns.defectCreate', docNo, after: rec, result: 'SUCCESS' });
      return rec;
    });
  }

  async approveDefect(id: number, userId: string, userRoles: string[]): Promise<DefectRecord> {
    const rec = await this.mustGetDefect(id);
    if (rec.status !== DefectStatus.PENDING_APPROVAL || !rec.approvalId) {
      throw new BizException('DEFECT_NOT_PENDING', `Defect ${rec.docNo} is not pending approval`);
    }
    await this.approval.approve(rec.approvalId, userId, userRoles);
    rec.status = DefectStatus.APPROVED;
    const saved = await this.defectRepo.save(rec);
    await this.audit.log({ operator: userId, action: 'returns.defectApprove', docNo: rec.docNo, result: 'SUCCESS' });
    return saved;
  }

  async rejectDefect(id: number, userId: string, userRoles: string[], reason?: string): Promise<DefectRecord> {
    const rec = await this.mustGetDefect(id);
    if (rec.status !== DefectStatus.PENDING_APPROVAL || !rec.approvalId) {
      throw new BizException('DEFECT_NOT_PENDING', `Defect ${rec.docNo} is not pending approval`);
    }
    await this.approval.reject(rec.approvalId, userId, userRoles, reason);
    rec.status = DefectStatus.REJECTED;
    return this.defectRepo.save(rec);
  }

  // ---------- 退料 ----------

  /**
   * 退料：不良退料（须关联已审批不良记录且数量足够）/ 超领退料 / 正常退料。
   * 超退上限 = 累计领用 − 累计消耗 − 累计已退；超限强制填原因 + 仓库主管审批（OVR 编号）。
   */
  async createReturn(input: {
    type: ReturnType;
    workOrderId: string;
    materialCode: string;
    batchNo?: string;
    qty: number;
    toStatus?: string;
    defectDocNo?: string;
    reason?: string;
    locationCode?: string;
    requestId: string;
    operator: string;
  }): Promise<ReturnOrder> {
    return this.idem.execute(input.requestId, 'returns.create', async () => {
      if (!Object.values(ReturnType).includes(input.type)) {
        throw new BizException('INVALID_TYPE', `Unknown return type: ${input.type}`);
      }
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');

      let toStatus = input.toStatus ?? StockStatus.QUALIFIED;
      if (input.type === ReturnType.DEFECT) {
        // 不良退料：必须关联已审批不良记录且登记数量 ≥ 本次退料数
        if (!input.defectDocNo) {
          throw new BizException('DEFECT_RECORD_REQUIRED', 'Defect return requires defectDocNo');
        }
        const defect = await this.defectRepo.findOne({ where: { docNo: input.defectDocNo } });
        if (!defect || defect.status !== DefectStatus.APPROVED) {
          throw new BizException('DEFECT_NOT_APPROVED', `Defect record ${input.defectDocNo} missing or not approved`);
        }
        if (defect.qty < input.qty) {
          throw new BizException(
            'DEFECT_QTY_EXCEED',
            `Defect record qty ${defect.qty} < return qty ${input.qty}`,
          );
        }
        toStatus = StockStatus.ISOLATED; // 不良退料入隔离区
      }
      if (![StockStatus.ISOLATED, StockStatus.QUALIFIED].includes(toStatus as StockStatus)) {
        throw new BizException('INVALID_TO_STATUS', 'toStatus must be ISOLATED or QUALIFIED');
      }

      // 超退判定
      const limit = await this.returnableQty(input.workOrderId, input.materialCode);
      const isOver = input.qty > limit;
      let docNo: string;
      let approvalId: number | null = null;
      let status = ReturnStatus.POSTED;
      if (isOver) {
        if (!input.reason) {
          throw new BizException(
            'OVER_RETURN_REASON_REQUIRED',
            `Return qty ${input.qty} exceeds returnable ${limit}; reason is required`,
          );
        }
        docNo = await this.numbering.next('OVR');
        const ap = await this.approval.create('return.over', docNo, input.operator, [
          { approverRole: OVER_RETURN_APPROVER_ROLE },
        ]);
        approvalId = ap.id;
        status = ReturnStatus.PENDING_APPROVAL;
      } else {
        docNo = await this.numbering.next('RTN');
      }

      let order = await this.returnRepo.save(
        this.returnRepo.create({
          docNo,
          type: input.type,
          workOrderId: input.workOrderId,
          materialCode: input.materialCode,
          batchNo: input.batchNo ?? null,
          qty: input.qty,
          toStatus,
          defectDocNo: input.defectDocNo ?? null,
          isOver,
          reason: input.reason ?? null,
          approvalId,
          status,
          returnPackageNo: null,
          operator: input.operator,
          postedAt: null,
        }),
      );
      if (!isOver) {
        order = await this.doPostReturn(order, input.locationCode, input.requestId, input.operator);
      }
      await this.audit.log({ operator: input.operator, action: 'returns.create', docNo, after: order, result: 'SUCCESS' });
      return order;
    });
  }

  /** 超退审批（仓库主管） */
  async approveReturn(id: number, userId: string, userRoles: string[]): Promise<ReturnOrder> {
    const order = await this.mustGetReturn(id);
    if (order.status !== ReturnStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('RETURN_NOT_PENDING', `Return ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    await this.audit.log({ operator: userId, action: 'returns.approve', docNo: order.docNo, result: 'SUCCESS' });
    return order;
  }

  /** 退料过账（超退单须审批已通过） */
  async postReturn(id: number, locationCode: string | undefined, requestId: string, operator: string): Promise<ReturnOrder> {
    return this.idem.execute(requestId, 'returns.post', async () => {
      const order = await this.mustGetReturn(id);
      if (order.status === ReturnStatus.POSTED) return order;
      const ap = order.approvalId ? await this.approval.get(order.approvalId) : null;
      if (ap?.status === ApprovalStatus.REJECTED) {
        order.status = ReturnStatus.REJECTED;
        await this.returnRepo.save(order);
        throw new BizException('RETURN_REJECTED', `Return ${order.docNo} approval rejected`);
      }
      if (order.status === ReturnStatus.PENDING_APPROVAL && ap?.status !== ApprovalStatus.APPROVED) {
        throw new BizException('NOT_APPROVED', `Return ${order.docNo} requires WH_MANAGER approval`);
      }
      const posted = await this.doPostReturn(order, locationCode, requestId, operator);
      await this.audit.log({ operator, action: 'returns.post', docNo: order.docNo, after: { status: posted.status }, result: 'SUCCESS' });
      return posted;
    });
  }

  // ---------- 补料 ----------

  /**
   * 补料：余量调拨（仅记录）/ 一退一补（退料交接完成才可补）/ 直接补料。
   * 防累计超限：累计已领+本次 > BOM 计划×(1+returns.overIssueRate) → 车间主任审批（OVR 编号）。
   */
  async createReplenish(input: {
    type: ReplenishType;
    workOrderId: string;
    materialCode: string;
    qty: number;
    relatedReturnDocNo?: string;
    requestId: string;
    operator: string;
  }): Promise<ReplenishOrder> {
    return this.idem.execute(input.requestId, 'returns.replenish', async () => {
      if (!Object.values(ReplenishType).includes(input.type)) {
        throw new BizException('INVALID_TYPE', `Unknown replenish type: ${input.type}`);
      }
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');

      if (input.type === ReplenishType.TRANSFER_ONLY) {
        // 余量调拨：无需补料，仅记录
        const docNo = await this.numbering.next('RTN');
        const order = await this.replenishRepo.save(
          this.replenishRepo.create({
            docNo,
            type: input.type,
            workOrderId: input.workOrderId,
            materialCode: input.materialCode,
            qty: input.qty,
            relatedReturnDocNo: null,
            isOver: false,
            approvalId: null,
            status: ReplenishStatus.POSTED,
            operator: input.operator,
            postedAt: new Date(),
          }),
        );
        await this.audit.log({ operator: input.operator, action: 'returns.replenish', docNo, after: order, result: 'SUCCESS' });
        return order;
      }

      if (input.type === ReplenishType.RETURN_AND_REPLENISH) {
        // 一退一补：退不良交接完成（退料单已过账）才可补
        if (!input.relatedReturnDocNo) {
          throw new BizException('RETURN_DOC_REQUIRED', 'RETURN_AND_REPLENISH requires relatedReturnDocNo');
        }
        const ret = await this.returnRepo.findOne({ where: { docNo: input.relatedReturnDocNo } });
        if (!ret || ret.type !== ReturnType.DEFECT || ret.status !== ReturnStatus.POSTED) {
          throw new BizException(
            'RETURN_NOT_COMPLETED',
            `Defect return ${input.relatedReturnDocNo} not completed; replenish is forbidden before handover`,
          );
        }
      }

      // 防累计超限
      const planQty = await this.bomPlanQty(input.workOrderId, input.materialCode);
      const issued = await this.issuedQty(input.workOrderId, input.materialCode);
      const rate = await this.overIssueRate();
      const isOver = planQty !== null && issued + input.qty > planQty * (1 + rate) + 1e-9;

      let docNo: string;
      let approvalId: number | null = null;
      let status = ReplenishStatus.POSTED;
      if (isOver) {
        docNo = await this.numbering.next('OVR');
        const ap = await this.approval.create('replenish.over', docNo, input.operator, [
          { approverRole: OVER_ISSUE_APPROVER_ROLE },
        ]);
        approvalId = ap.id;
        status = ReplenishStatus.PENDING_APPROVAL;
      } else {
        docNo = await this.numbering.next('RTN');
      }

      let order = await this.replenishRepo.save(
        this.replenishRepo.create({
          docNo,
          type: input.type,
          workOrderId: input.workOrderId,
          materialCode: input.materialCode,
          qty: input.qty,
          relatedReturnDocNo: input.relatedReturnDocNo ?? null,
          isOver,
          approvalId,
          status,
          operator: input.operator,
          postedAt: null,
        }),
      );
      if (!isOver) {
        order = await this.doPostReplenish(order, input.requestId, input.operator);
      }
      await this.audit.log({ operator: input.operator, action: 'returns.replenish', docNo, after: order, result: 'SUCCESS' });
      return order;
    });
  }

  /** 超领审批（车间主任） */
  async approveReplenish(id: number, userId: string, userRoles: string[]): Promise<ReplenishOrder> {
    const order = await this.mustGetReplenish(id);
    if (order.status !== ReplenishStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('REPLENISH_NOT_PENDING', `Replenish ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    await this.audit.log({ operator: userId, action: 'returns.replenishApprove', docNo: order.docNo, result: 'SUCCESS' });
    return order;
  }

  /** 补料过账（超领单须审批已通过）：为工单占用新料 */
  async postReplenish(id: number, requestId: string, operator: string): Promise<ReplenishOrder> {
    return this.idem.execute(requestId, 'returns.replenishPost', async () => {
      const order = await this.mustGetReplenish(id);
      if (order.status === ReplenishStatus.POSTED) return order;
      const ap = order.approvalId ? await this.approval.get(order.approvalId) : null;
      if (ap?.status === ApprovalStatus.REJECTED) {
        order.status = ReplenishStatus.REJECTED;
        await this.replenishRepo.save(order);
        throw new BizException('REPLENISH_REJECTED', `Replenish ${order.docNo} approval rejected`);
      }
      if (order.status === ReplenishStatus.PENDING_APPROVAL && ap?.status !== ApprovalStatus.APPROVED) {
        throw new BizException('NOT_APPROVED', `Replenish ${order.docNo} requires WORKSHOP_DIRECTOR approval`);
      }
      const posted = await this.doPostReplenish(order, requestId, operator);
      await this.audit.log({ operator, action: 'returns.replenishPost', docNo: order.docNo, after: { status: posted.status }, result: 'SUCCESS' });
      return posted;
    });
  }

  // ---------- 损耗核销 ----------

  /** 创建损耗核销单：质量工程师 + 财务双审批 */
  async createWriteoff(input: {
    workOrderId?: string;
    materialCode: string;
    batchNo: string;
    packageNo: string;
    qty: number;
    reason: WriteoffReason;
    customerOrderNo?: string;
    requestId: string;
    operator: string;
  }): Promise<WriteoffOrder> {
    return this.idem.execute(input.requestId, 'returns.writeoffCreate', async () => {
      if (!Object.values(WriteoffReason).includes(input.reason)) {
        throw new BizException('INVALID_REASON', `Unknown writeoff reason: ${input.reason}`);
      }
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');
      if (input.reason === WriteoffReason.CUSTOMER_INSPECT && !input.customerOrderNo) {
        throw new BizException('CUSTOMER_ORDER_REQUIRED', 'customerOrderNo is required for CUSTOMER_INSPECT');
      }
      const lot = await this.lotRepo.findOne({ where: { packageNo: input.packageNo } });
      if (!lot) throw new BizException('LOT_NOT_FOUND', `packageNo ${input.packageNo} not found`, 404);
      if (lot.qty < input.qty) {
        throw new BizException('INVALID_QTY', `Lot qty ${lot.qty} < writeoff qty ${input.qty}`);
      }
      const docNo = await this.numbering.next('LS');
      const ap = await this.approval.create('writeoff', docNo, input.operator, WRITEOFF_STEPS);
      const order = await this.writeoffRepo.save(
        this.writeoffRepo.create({
          docNo,
          workOrderId: input.workOrderId ?? null,
          materialCode: input.materialCode,
          batchNo: input.batchNo,
          packageNo: input.packageNo,
          qty: input.qty,
          reason: input.reason,
          customerOrderNo: input.customerOrderNo ?? null,
          approvalId: ap.id,
          status: WriteoffStatus.PENDING_APPROVAL,
          u8Synced: false,
          operator: input.operator,
          postedAt: null,
        }),
      );
      await this.audit.log({ operator: input.operator, action: 'returns.writeoffCreate', docNo, after: order, result: 'SUCCESS' });
      return order;
    });
  }

  /** 双审批之一（QE → FINANCE 顺序审批） */
  async approveWriteoff(id: number, userId: string, userRoles: string[]): Promise<WriteoffOrder> {
    const order = await this.mustGetWriteoff(id);
    if (order.status !== WriteoffStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('WRITEOFF_NOT_PENDING', `Writeoff ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    await this.audit.log({ operator: userId, action: 'returns.writeoffApprove', docNo: order.docNo, result: 'SUCCESS' });
    return order;
  }

  /** 任一审批拒绝即作废，不得过账 */
  async rejectWriteoff(id: number, userId: string, userRoles: string[], reason?: string): Promise<WriteoffOrder> {
    const order = await this.mustGetWriteoff(id);
    if (order.status !== WriteoffStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('WRITEOFF_NOT_PENDING', `Writeoff ${order.docNo} is not pending approval`);
    }
    await this.approval.reject(order.approvalId, userId, userRoles, reason);
    order.status = WriteoffStatus.VOID;
    const saved = await this.writeoffRepo.save(order);
    await this.audit.log({ operator: userId, action: 'returns.writeoffReject', docNo: order.docNo, after: { reason }, result: 'SUCCESS' });
    return saved;
  }

  /** 核销过账：adjust 扣减 + SyncService 同步 U8（核销单↔U8 单据 bizKey 一一对应） */
  async postWriteoff(id: number, requestId: string, operator: string): Promise<WriteoffOrder> {
    return this.idem.execute(requestId, 'returns.writeoffPost', async () => {
      const order = await this.mustGetWriteoff(id);
      if (order.status === WriteoffStatus.POSTED) return order;
      if (order.status === WriteoffStatus.VOID) {
        throw new BizException('WRITEOFF_VOID', `Writeoff ${order.docNo} is void, cannot post`);
      }
      const ap = order.approvalId ? await this.approval.get(order.approvalId) : null;
      if (ap?.status === ApprovalStatus.REJECTED) {
        order.status = WriteoffStatus.VOID;
        await this.writeoffRepo.save(order);
        throw new BizException('WRITEOFF_VOID', `Writeoff ${order.docNo} approval rejected, voided`);
      }
      if (ap?.status !== ApprovalStatus.APPROVED) {
        throw new BizException('NOT_APPROVED', `Writeoff ${order.docNo} requires QE + FINANCE dual approval`);
      }
      const lot = await this.lotRepo.findOne({ where: { packageNo: order.packageNo } });
      if (!lot || lot.qty < order.qty) {
        throw new BizException('INVALID_QTY', `Lot qty insufficient for writeoff ${order.docNo}`);
      }
      await this.inv.adjust(order.packageNo, lot.qty - order.qty, `损耗核销:${order.reason}`, order.docNo, `${requestId}:adjust`, operator);
      const task = await this.sync.enqueue({
        bizType: 'writeoff',
        bizKey: order.docNo,
        voucherType: 'WRITE_OFF',
        payload: {
          docNo: order.docNo,
          workOrderId: order.workOrderId,
          materialCode: order.materialCode,
          batchNo: order.batchNo,
          qty: order.qty,
          reason: order.reason,
          customerOrderNo: order.customerOrderNo,
        },
      });
      order.status = WriteoffStatus.POSTED;
      order.u8Synced = task.status === DocStatus.SYNCED;
      order.postedAt = new Date();
      const saved = await this.writeoffRepo.save(order);
      await this.audit.log({
        operator,
        action: 'returns.writeoffPost',
        docNo: order.docNo,
        after: { status: saved.status, u8Synced: saved.u8Synced },
        result: 'SUCCESS',
      });
      return saved;
    });
  }

  writeoffs() {
    return this.writeoffRepo.find({ order: { id: 'DESC' } });
  }

  /** 核销台账 CSV 导出 */
  async exportWriteoffs(): Promise<string> {
    const rows = await this.writeoffRepo.find({ order: { id: 'ASC' } });
    const header = 'docNo,workOrderId,materialCode,batchNo,packageNo,qty,reason,customerOrderNo,status,u8Synced,operator,createdAt,postedAt';
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.docNo, r.workOrderId, r.materialCode, r.batchNo, r.packageNo, r.qty,
        r.reason, r.customerOrderNo, r.status, r.u8Synced, r.operator,
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        r.postedAt ? new Date(r.postedAt).toISOString() : '',
      ].map(esc).join(','),
    );
    return [header, ...lines].join('\n');
  }

  // ---------- 良/不良调拨 ----------

  /** 创建良/不良调拨单（QUALIFIED↔ISOLATED 整包双向）；不良调回良品须质量审批 */
  async createQTransfer(input: {
    packageNo: string;
    toStatus: string;
    toLocation?: string;
    reason: string;
    requestId: string;
    operator: string;
    reverseOfDocNo?: string;
  }): Promise<QualityTransfer> {
    return this.idem.execute(input.requestId, 'returns.qtransferCreate', async () => {
      const lot = await this.lotRepo.findOne({ where: { packageNo: input.packageNo } });
      if (!lot) throw new BizException('LOT_NOT_FOUND', `packageNo ${input.packageNo} not found`, 404);
      const fromStatus = lot.status;
      if (![StockStatus.QUALIFIED, StockStatus.ISOLATED].includes(fromStatus as StockStatus)) {
        throw new BizException('INVALID_FROM_STATUS', `Lot status ${fromStatus} cannot be quality-transferred`);
      }
      if (![StockStatus.QUALIFIED, StockStatus.ISOLATED].includes(input.toStatus as StockStatus)) {
        throw new BizException('INVALID_TO_STATUS', 'toStatus must be QUALIFIED or ISOLATED');
      }
      if (fromStatus === input.toStatus) {
        throw new BizException('SAME_STATUS', 'fromStatus and toStatus must differ');
      }
      const docNo = await this.numbering.next('QT');
      // 不良调回良品（ISOLATED→QUALIFIED）须重新走审批
      const needApproval = input.toStatus === StockStatus.QUALIFIED;
      let approvalId: number | null = null;
      let status: QTransferStatus = QTransferStatus.DRAFT;
      if (needApproval) {
        const ap = await this.approval.create('qtransfer', docNo, input.operator, [
          { approverRole: QE_ROLE },
        ]);
        approvalId = ap.id;
        status = QTransferStatus.PENDING_APPROVAL;
      }
      const order = await this.qtRepo.save(
        this.qtRepo.create({
          docNo,
          materialCode: lot.materialCode,
          batchNo: lot.batchNo,
          packageNo: lot.packageNo,
          qty: lot.qty,
          fromStatus,
          toStatus: input.toStatus,
          fromLocation: lot.locationCode,
          toLocation: input.toLocation ?? null,
          reason: input.reason,
          confirmBy: null,
          confirmRole: null,
          confirmedAt: null,
          approvalId,
          reverseOfDocNo: input.reverseOfDocNo ?? null,
          status,
          operator: input.operator,
          postedAt: null,
        }),
      );
      await this.audit.log({ operator: input.operator, action: 'returns.qtransferCreate', docNo, after: order, result: 'SUCCESS' });
      return order;
    });
  }

  /** 反向调拨：新建反向单关联原单，不直接改原单 */
  async reverseQTransfer(id: number, reason: string | undefined, requestId: string, operator: string): Promise<QualityTransfer> {
    const origin = await this.mustGetQt(id);
    if (origin.status !== QTransferStatus.POSTED) {
      throw new BizException('QT_NOT_POSTED', `Quality transfer ${origin.docNo} not posted, cannot reverse`);
    }
    const dup = await this.qtRepo.findOne({ where: { reverseOfDocNo: origin.docNo } });
    if (dup) throw new BizException('REVERSE_EXISTS', `Reverse of ${origin.docNo} already exists: ${dup.docNo}`);
    return this.createQTransfer({
      packageNo: origin.packageNo,
      toStatus: origin.fromStatus,
      toLocation: origin.fromLocation,
      reason: reason ?? `reverse of ${origin.docNo}`,
      requestId,
      operator,
      reverseOfDocNo: origin.docNo,
    });
  }

  /** 质检员/质量工程师电子签确认（不过账的必经前置） */
  async confirmQTransfer(id: number, userId: string, userRoles: string[]): Promise<QualityTransfer> {
    const order = await this.mustGetQt(id);
    if (order.status === QTransferStatus.POSTED || order.status === QTransferStatus.REJECTED) {
      throw new BizException('QT_NOT_CONFIRMABLE', `Quality transfer ${order.docNo} cannot be confirmed in status ${order.status}`);
    }
    const role = userRoles.find((r) => QUALITY_SIGN_ROLES.includes(r));
    if (!role) {
      throw new BizException('QUALITY_ROLE_REQUIRED', 'Quality sign requires INSPECTOR or QE role');
    }
    order.confirmBy = userId;
    order.confirmRole = role;
    order.confirmedAt = new Date();
    if (order.status === QTransferStatus.DRAFT) order.status = QTransferStatus.CONFIRMED;
    const saved = await this.qtRepo.save(order);
    await this.audit.log({
      operator: userId,
      role,
      action: 'returns.qtransferConfirm',
      docNo: order.docNo,
      after: { confirmBy: userId, confirmRole: role },
      result: 'SUCCESS',
    });
    return saved;
  }

  /** 不良调回良品的质量审批 */
  async approveQTransfer(id: number, userId: string, userRoles: string[]): Promise<QualityTransfer> {
    const order = await this.mustGetQt(id);
    if (order.status !== QTransferStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('QT_NOT_PENDING', `Quality transfer ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    await this.audit.log({ operator: userId, action: 'returns.qtransferApprove', docNo: order.docNo, result: 'SUCCESS' });
    return order;
  }

  /** 过账：须电子签 + （不良调回良品须审批通过）；changeStatus 后两边库存平衡 */
  async postQTransfer(id: number, requestId: string, operator: string): Promise<QualityTransfer> {
    return this.idem.execute(requestId, 'returns.qtransferPost', async () => {
      const order = await this.mustGetQt(id);
      if (order.status === QTransferStatus.POSTED) return order;
      if (!order.confirmBy) {
        throw new BizException('QUALITY_CONFIRM_REQUIRED', `Quality transfer ${order.docNo} requires quality e-sign before posting`);
      }
      if (order.approvalId) {
        const ap = await this.approval.get(order.approvalId);
        if (ap.status === ApprovalStatus.REJECTED) {
          order.status = QTransferStatus.REJECTED;
          await this.qtRepo.save(order);
          throw new BizException('QT_REJECTED', `Quality transfer ${order.docNo} approval rejected`);
        }
        if (ap.status !== ApprovalStatus.APPROVED) {
          throw new BizException('NOT_APPROVED', `Quality transfer ${order.docNo} requires QE approval (ISOLATED→QUALIFIED)`);
        }
      }
      await this.inv.changeStatus(order.packageNo, order.toStatus as StockStatus, order.docNo, `${requestId}:status`, operator);
      if (order.toLocation) {
        await this.inv.moveLocation(order.packageNo, order.toLocation, order.docNo, `${requestId}:move`, operator);
      }
      order.status = QTransferStatus.POSTED;
      order.postedAt = new Date();
      const saved = await this.qtRepo.save(order);
      await this.audit.log({
        operator,
        action: 'returns.qtransferPost',
        docNo: order.docNo,
        after: { status: saved.status, toStatus: order.toStatus },
        result: 'SUCCESS',
      });
      return saved;
    });
  }

  // ---------- 查询 ----------

  returns(filter?: { isOver?: boolean }) {
    return this.returnRepo.find({
      where: filter?.isOver !== undefined ? { isOver: filter.isOver } : {},
      order: { id: 'DESC' },
    });
  }

  replenishes(filter?: { isOver?: boolean }) {
    return this.replenishRepo.find({
      where: filter?.isOver !== undefined ? { isOver: filter.isOver } : {},
      order: { id: 'DESC' },
    });
  }

  qtransfers() {
    return this.qtRepo.find({ order: { id: 'DESC' } });
  }

  defects() {
    return this.defectRepo.find({ order: { id: 'DESC' } });
  }

  returnDetail(id: number) {
    return this.mustGetReturn(id);
  }

  replenishDetail(id: number) {
    return this.mustGetReplenish(id);
  }

  writeoffDetail(id: number) {
    return this.mustGetWriteoff(id);
  }

  qtDetail(id: number) {
    return this.mustGetQt(id);
  }

  // ---------- internals ----------

  /** 退料过账：实物退回入库（ISOLATED 或 QUALIFIED 新批次） */
  private async doPostReturn(order: ReturnOrder, locationCode: string | undefined, requestId: string, operator: string): Promise<ReturnOrder> {
    const packageNo = `${order.docNo}-PKG`;
    await this.inv.inbound({
      packageNo,
      materialCode: order.materialCode,
      batchNo: order.batchNo ?? order.docNo,
      qty: order.qty,
      warehouseCode: 'WH01',
      locationCode: locationCode ?? (await this.defaultLocation()),
      status: order.toStatus as StockStatus,
      workOrderId: order.workOrderId,
      sourceDocNo: order.docNo,
      requestId: `${requestId}:inbound`,
      operator,
    });
    order.status = ReturnStatus.POSTED;
    order.returnPackageNo = packageNo;
    order.postedAt = new Date();
    return this.returnRepo.save(order);
  }

  /** 补料过账：为工单占用新料（占用校验可用量） */
  private async doPostReplenish(order: ReplenishOrder, requestId: string, operator: string): Promise<ReplenishOrder> {
    await this.inv.occupy(
      order.workOrderId,
      [{ materialCode: order.materialCode, qty: order.qty }],
      order.docNo,
      `${requestId}:occupy`,
      operator,
    );
    order.status = ReplenishStatus.POSTED;
    order.postedAt = new Date();
    return this.replenishRepo.save(order);
  }

  /** 可退上限 = 累计领用 − 累计消耗 − 累计已退 */
  private async returnableQty(workOrderId: string, materialCode: string): Promise<number> {
    const issued = await this.issuedQty(workOrderId, materialCode);
    const consumed = await this.consumedQty(workOrderId, materialCode);
    const returned = await this.returnedQty(workOrderId, materialCode);
    return Number((issued - consumed - returned).toFixed(6));
  }

  /** 累计已领 = ACTIVE + CONSUMED 占用合计 */
  private async issuedQty(workOrderId: string, materialCode: string): Promise<number> {
    const rows = await this.occRepo.find({ where: { workOrderId, materialCode } });
    return rows
      .filter((o) => o.status === OccupationStatus.ACTIVE || o.status === OccupationStatus.CONSUMED)
      .reduce((s, o) => s + o.qty, 0);
  }

  private async consumedQty(workOrderId: string, materialCode: string): Promise<number> {
    const rows = await this.occRepo.find({
      where: { workOrderId, materialCode, status: OccupationStatus.CONSUMED },
    });
    return rows.reduce((s, o) => s + o.qty, 0);
  }

  private async returnedQty(workOrderId: string, materialCode: string): Promise<number> {
    const rows = await this.returnRepo.find({
      where: { workOrderId, materialCode, status: ReturnStatus.POSTED },
    });
    return rows.reduce((s, o) => s + o.qty, 0);
  }

  /** BOM 计划用量 = BOM 单位用量 × 工单计划数；无 BOM 返回 null（跳过超限校验） */
  private async bomPlanQty(workOrderId: string, materialCode: string): Promise<number | null> {
    const wo = await this.woRepo.findOne({ where: { workOrderId } });
    if (!wo) return null;
    const bom = await this.bomRepo.findOne({ where: { productCode: wo.productCode } });
    const item = bom?.items?.find((i) => i.materialCode === materialCode);
    if (!item) return null;
    return item.qty * wo.planQty;
  }

  private async overIssueRate(): Promise<number> {
    const raw = await this.ruleConfig.get('returns.overIssueRate');
    const n = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 0.1;
  }

  private async defaultLocation(): Promise<string> {
    const loc = await this.locationRepo.findOne({ where: { warehouseCode: 'WH01', areaCode: 'A' } });
    return loc?.locationCode ?? 'WH01-A-01';
  }

  private async mustGetDefect(id: number): Promise<DefectRecord> {
    const rec = await this.defectRepo.findOne({ where: { id } });
    if (!rec) throw new BizException('DEFECT_NOT_FOUND', `Defect ${id} not found`, 404);
    return rec;
  }

  private async mustGetReturn(id: number): Promise<ReturnOrder> {
    const order = await this.returnRepo.findOne({ where: { id } });
    if (!order) throw new BizException('RETURN_NOT_FOUND', `Return ${id} not found`, 404);
    return order;
  }

  private async mustGetReplenish(id: number): Promise<ReplenishOrder> {
    const order = await this.replenishRepo.findOne({ where: { id } });
    if (!order) throw new BizException('REPLENISH_NOT_FOUND', `Replenish ${id} not found`, 404);
    return order;
  }

  private async mustGetWriteoff(id: number): Promise<WriteoffOrder> {
    const order = await this.writeoffRepo.findOne({ where: { id } });
    if (!order) throw new BizException('WRITEOFF_NOT_FOUND', `Writeoff ${id} not found`, 404);
    return order;
  }

  private async mustGetQt(id: number): Promise<QualityTransfer> {
    const order = await this.qtRepo.findOne({ where: { id } });
    if (!order) throw new BizException('QT_NOT_FOUND', `Quality transfer ${id} not found`, 404);
    return order;
  }
}
