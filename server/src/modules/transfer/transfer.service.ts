import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MovementType, OccupationStatus } from '../../common/enums';
import { ApprovalStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { InventoryService } from '../inventory/inventory.service';
import { StockOccupation } from '../inventory/entities/stock-occupation.entity';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { StockMovement } from '../inventory/entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';
import {
  TransferOrder,
  TransferKind,
  TransferStatus,
} from './entities/transfer-order.entity';
import { ReplenishTodo, ReplenishTodoStatus } from './entities/replenish-todo.entity';
import { ReworkOrder, ReworkStatus } from './entities/rework-order.entity';

export interface CreateTransferInput {
  sourceWorkOrderId: string;
  targetWorkOrderId: string;
  materialCode: string;
  batchNo?: string;
  qty: number;
  requestId: string;
  operator: string;
}

/** 专用件跨工单挪料审批人角色：班组长（或以上角色另行授权） */
const SPECIAL_APPROVER_ROLE = 'LEADER';
/** 返工审批人角色：班组长 */
const REWORK_APPROVER_ROLE = 'LEADER';

/**
 * 工单挪料（REQ-012~014 + 纪要返工）。
 * 占用关系过账：释放源工单 ACTIVE 占用（部分释放按先进先出拆分）+ 建立目标工单占用；
 * InventoryService 无部分释放 API，故占用行拆放与流水（RELEASE/OCCUPY）在本模块事务内直写，
 * 不改动任何共享文件。
 */
@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(TransferOrder)
    private readonly orderRepo: Repository<TransferOrder>,
    @InjectRepository(ReplenishTodo)
    private readonly todoRepo: Repository<ReplenishTodo>,
    @InjectRepository(ReworkOrder)
    private readonly reworkRepo: Repository<ReworkOrder>,
    @InjectRepository(StockOccupation)
    private readonly occRepo: Repository<StockOccupation>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(StockMovement)
    private readonly movRepo: Repository<StockMovement>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly inv: InventoryService,
    private readonly approval: ApprovalEngineService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly idem: IdempotencyService,
  ) {}

  /** 创建挪料单：校验禁止超挪/已消耗不可挪；专用件（含未确认）发起班组长审批，通用件直接过账 */
  async create(input: CreateTransferInput): Promise<TransferOrder> {
    return this.idem.execute(input.requestId, 'transfer.create', async () => {
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');
      if (input.sourceWorkOrderId === input.targetWorkOrderId) {
        throw new BizException('SAME_WORK_ORDER', 'source and target work order must differ');
      }
      const material = await this.materialRepo.findOne({
        where: { materialCode: input.materialCode },
      });
      if (!material) throw new BizException('MATERIAL_NOT_FOUND', `Material ${input.materialCode} not found`, 404);

      // 仅 ACTIVE 占用可挪：CONSUMED（已实际消耗）不计入可挪量，天然拒绝；超出 ACTIVE 总量即超挪
      const activeQty = await this.activeOccupiedQty(input.sourceWorkOrderId, input.materialCode);
      if (input.qty > activeQty) {
        throw new BizException(
          'TRANSFER_EXCEED',
          `Transfer qty ${input.qty} exceeds ACTIVE occupied ${activeQty} (consumed qty cannot be transferred)`,
        );
      }

      // REQ-013：isSpecial 未确认（PENDING）按专用件严格管控
      const isSpecialCtrl = material.isSpecial || material.specialStatus === 'PENDING';
      const docNo = await this.numbering.next('TRF');
      const order = this.orderRepo.create({
        docNo,
        sourceWorkOrderId: input.sourceWorkOrderId,
        targetWorkOrderId: input.targetWorkOrderId,
        materialCode: input.materialCode,
        batchNo: input.batchNo ?? null,
        qty: input.qty,
        needApproval: isSpecialCtrl,
        approvalId: null,
        kind: TransferKind.NORMAL,
        relatedDocNo: null,
        operator: input.operator,
        approver: null,
        status: TransferStatus.PENDING_APPROVAL,
        postedAt: null,
      });
      if (isSpecialCtrl) {
        const ap = await this.approval.create('transfer', docNo, input.operator, [
          { approverRole: SPECIAL_APPROVER_ROLE },
        ]);
        order.approvalId = ap.id;
        const saved = await this.orderRepo.save(order);
        await this.audit.log({
          operator: input.operator,
          action: 'transfer.create',
          docNo,
          after: { ...saved, approval: 'PENDING' },
          result: 'SUCCESS',
        });
        return saved;
      }
      // 通用件无需审批，直接过账（领用必须关联消耗工单 = targetWorkOrderId，已强校验）
      const saved = await this.orderRepo.save(order);
      const posted = await this.doPost(saved, input.requestId, input.operator);
      await this.audit.log({
        operator: input.operator,
        action: 'transfer.create',
        docNo,
        after: posted,
        result: 'SUCCESS',
      });
      return posted;
    });
  }

  /** 班组长审批（专用件挪料）；审批引擎硬约束禁止自审 */
  async approve(id: number, userId: string, userRoles: string[]): Promise<TransferOrder> {
    const order = await this.mustGetOrder(id);
    if (order.status !== TransferStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('TRANSFER_NOT_PENDING', `Transfer ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    order.status = TransferStatus.APPROVED;
    order.approver = userId;
    const saved = await this.orderRepo.save(order);
    await this.audit.log({
      operator: userId,
      action: 'transfer.approve',
      docNo: order.docNo,
      after: { approver: userId },
      result: 'SUCCESS',
    });
    return saved;
  }

  async reject(id: number, userId: string, userRoles: string[], reason?: string): Promise<TransferOrder> {
    const order = await this.mustGetOrder(id);
    if (order.status !== TransferStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('TRANSFER_NOT_PENDING', `Transfer ${order.docNo} is not pending approval`);
    }
    await this.approval.reject(order.approvalId, userId, userRoles, reason);
    order.status = TransferStatus.REJECTED;
    const saved = await this.orderRepo.save(order);
    await this.audit.log({
      operator: userId,
      action: 'transfer.reject',
      docNo: order.docNo,
      after: { reason },
      result: 'SUCCESS',
    });
    return saved;
  }

  /** 过账（MVP 显式检查 Approval 状态 = afterApproval 钩子）：释放源占用 + 建立目标占用 */
  async post(id: number, requestId: string, operator: string): Promise<TransferOrder> {
    return this.idem.execute(requestId, 'transfer.post', async () => {
      const order = await this.mustGetOrder(id);
      if (order.status === TransferStatus.POSTED) return order;
      if (order.needApproval) {
        const ap = order.approvalId ? await this.approval.get(order.approvalId) : null;
        if (ap?.status === ApprovalStatus.REJECTED) {
          order.status = TransferStatus.REJECTED;
          await this.orderRepo.save(order);
          throw new BizException('TRANSFER_REJECTED', `Transfer ${order.docNo} approval rejected`);
        }
        if (ap?.status !== ApprovalStatus.APPROVED) {
          throw new BizException('NOT_APPROVED', `Transfer ${order.docNo} requires LEADER approval before posting`);
        }
      }
      const posted = await this.doPost(order, requestId, operator);
      await this.audit.log({
        operator,
        action: 'transfer.post',
        docNo: order.docNo,
        after: { status: posted.status, postedAt: posted.postedAt },
        result: 'SUCCESS',
      });
      return posted;
    });
  }

  /**
   * 到货补回提醒（REQ-014）：扫描等待该物料且曾被挪出的工单，生成补料待办。
   * 原挪料记录保留，不得删除/改写。
   */
  async replenishCheck(materialCode: string, operator: string): Promise<ReplenishTodo[]> {
    const transfers = await this.orderRepo.find({
      where: { materialCode, kind: TransferKind.NORMAL, status: TransferStatus.POSTED },
      order: { id: 'ASC' },
    });
    const created: ReplenishTodo[] = [];
    for (const t of transfers) {
      const dup = await this.todoRepo.findOne({ where: { transferDocNo: t.docNo } });
      if (dup) continue;
      created.push(
        await this.todoRepo.save(
          this.todoRepo.create({
            materialCode,
            workOrderId: t.sourceWorkOrderId,
            transferDocNo: t.docNo,
            movedQty: t.qty,
            replenishedQty: 0,
            reverseDocNo: null,
            status: ReplenishTodoStatus.OPEN,
            closedAt: null,
          }),
        ),
      );
    }
    if (created.length) {
      await this.audit.log({
        operator,
        action: 'transfer.replenishCheck',
        after: { materialCode, created: created.map((c) => c.transferDocNo) },
        result: 'SUCCESS',
      });
    }
    return created;
  }

  /** PMC 确认补回：创建反向挪料单（不过账原单、不改写原记录）并关闭待办 */
  async confirmReplenish(todoId: number, requestId: string, operator: string): Promise<{ todo: ReplenishTodo; reverse: TransferOrder }> {
    return this.idem.execute(requestId, 'transfer.confirmReplenish', async () => {
      const todo = await this.todoRepo.findOne({ where: { id: todoId } });
      if (!todo) throw new BizException('TODO_NOT_FOUND', `ReplenishTodo ${todoId} not found`, 404);
      if (todo.status !== ReplenishTodoStatus.OPEN) {
        throw new BizException('TODO_CLOSED', `ReplenishTodo ${todoId} already closed`);
      }
      const origin = await this.orderRepo.findOne({ where: { docNo: todo.transferDocNo } });
      if (!origin) throw new BizException('TRANSFER_NOT_FOUND', `Transfer ${todo.transferDocNo} not found`, 404);
      const remaining = Number((todo.movedQty - todo.replenishedQty).toFixed(6));
      if (remaining <= 0) throw new BizException('TODO_FULFILLED', 'Nothing to replenish');

      const activeQty = await this.activeOccupiedQty(origin.targetWorkOrderId, origin.materialCode);
      if (remaining > activeQty) {
        throw new BizException(
          'TRANSFER_EXCEED',
          `Reverse qty ${remaining} exceeds ACTIVE occupied ${activeQty} on WO ${origin.targetWorkOrderId}`,
        );
      }

      const docNo = await this.numbering.next('TRF');
      let reverse = this.orderRepo.create({
        docNo,
        sourceWorkOrderId: origin.targetWorkOrderId,
        targetWorkOrderId: origin.sourceWorkOrderId,
        materialCode: origin.materialCode,
        batchNo: origin.batchNo,
        qty: remaining,
        needApproval: false,
        approvalId: null,
        kind: TransferKind.REPLENISH,
        relatedDocNo: origin.docNo,
        operator,
        approver: null,
        status: TransferStatus.PENDING_APPROVAL,
        postedAt: null,
      });
      reverse = await this.orderRepo.save(reverse);
      reverse = await this.doPost(reverse, requestId, operator);

      todo.replenishedQty = todo.movedQty;
      todo.reverseDocNo = docNo;
      todo.status = ReplenishTodoStatus.CLOSED;
      todo.closedAt = new Date();
      const savedTodo = await this.todoRepo.save(todo);

      await this.audit.log({
        operator,
        action: 'transfer.confirmReplenish',
        docNo,
        after: { todoId, reverseDocNo: docNo, originDocNo: origin.docNo },
        result: 'SUCCESS',
      });
      return { todo: savedTodo, reverse };
    });
  }

  todos(status?: ReplenishTodoStatus) {
    return this.todoRepo.find({
      where: status ? { status } : {},
      order: { id: 'DESC' },
    });
  }

  /** 挪料路径追溯：按批次返回挪料链路（含反向补回单） */
  async trace(lotId: string) {
    const chain = await this.orderRepo.find({
      where: { batchNo: lotId },
      order: { id: 'ASC' },
    });
    return {
      lotId,
      chain: chain.map((t) => ({
        docNo: t.docNo,
        kind: t.kind,
        materialCode: t.materialCode,
        sourceWorkOrderId: t.sourceWorkOrderId,
        targetWorkOrderId: t.targetWorkOrderId,
        qty: t.qty,
        status: t.status,
        relatedDocNo: t.relatedDocNo,
        operator: t.operator,
        approver: t.approver,
        postedAt: t.postedAt,
        createdAt: t.createdAt,
      })),
    };
  }

  /** 专用件批次查询：批次 + 所属工单维度 */
  async batches(materialCode: string) {
    const lots = await this.lotRepo.find({ where: { materialCode }, order: { receivedAt: 'ASC' } });
    const occupations = await this.occRepo.find({
      where: { materialCode, status: OccupationStatus.ACTIVE },
    });
    return {
      materialCode,
      lots: lots.map((l) => ({
        packageNo: l.packageNo,
        batchNo: l.batchNo,
        qty: l.qty,
        status: l.status,
        locationCode: l.locationCode,
        workOrderId: l.workOrderId,
      })),
      occupations: occupations.map((o) => ({
        workOrderId: o.workOrderId,
        qty: o.qty,
        prepDocNo: o.prepDocNo,
      })),
    };
  }

  /** 返工申请（纪要）：发起审批，批准后状态=已批准 */
  async applyRework(input: {
    workOrderId: string;
    materialCode: string;
    qty: number;
    reason: string;
    requestId: string;
    operator: string;
  }): Promise<ReworkOrder> {
    return this.idem.execute(input.requestId, 'transfer.reworkApply', async () => {
      if (input.qty <= 0) throw new BizException('INVALID_QTY', 'qty must be > 0');
      const docNo = await this.numbering.next('RWK');
      const ap = await this.approval.create('rework', docNo, input.operator, [
        { approverRole: REWORK_APPROVER_ROLE },
      ]);
      const order = await this.reworkRepo.save(
        this.reworkRepo.create({
          docNo,
          workOrderId: input.workOrderId,
          materialCode: input.materialCode,
          qty: input.qty,
          reason: input.reason,
          approvalId: ap.id,
          status: ReworkStatus.PENDING_APPROVAL,
          applicant: input.operator,
          issuePrepDocNo: null,
          issuedAt: null,
        }),
      );
      await this.audit.log({
        operator: input.operator,
        action: 'transfer.reworkApply',
        docNo,
        after: order,
        result: 'SUCCESS',
      });
      return order;
    });
  }

  async approveRework(id: number, userId: string, userRoles: string[]): Promise<ReworkOrder> {
    const order = await this.mustGetRework(id);
    if (order.status !== ReworkStatus.PENDING_APPROVAL || !order.approvalId) {
      throw new BizException('REWORK_NOT_PENDING', `Rework ${order.docNo} is not pending approval`);
    }
    await this.approval.approve(order.approvalId, userId, userRoles);
    order.status = ReworkStatus.APPROVED;
    const saved = await this.reworkRepo.save(order);
    await this.audit.log({
      operator: userId,
      action: 'transfer.reworkApprove',
      docNo: order.docNo,
      after: { status: saved.status },
      result: 'SUCCESS',
    });
    return saved;
  }

  /** 返工发料：无已批准返工单即拒（防止未补料即返工）；批准后核销工单占用出库 */
  async issueRework(id: number, prepDocNo: string, requestId: string, operator: string): Promise<ReworkOrder> {
    return this.idem.execute(requestId, 'transfer.reworkIssue', async () => {
      const order = await this.mustGetRework(id);
      if (order.status === ReworkStatus.ISSUED) return order;
      const ap = order.approvalId ? await this.approval.get(order.approvalId) : null;
      if (ap?.status !== ApprovalStatus.APPROVED || order.status !== ReworkStatus.APPROVED) {
        throw new BizException(
          'REWORK_NOT_APPROVED',
          `Rework ${order.docNo} is not approved; rework issue is forbidden`,
        );
      }
      // 校验该工单对应物料仍有 ACTIVE 占用可核销
      const occ = await this.occRepo.findOne({
        where: {
          prepDocNo,
          workOrderId: order.workOrderId,
          materialCode: order.materialCode,
          status: OccupationStatus.ACTIVE,
        },
      });
      if (!occ || occ.qty < order.qty) {
        throw new BizException(
          'REWORK_NO_OCCUPATION',
          `No sufficient ACTIVE occupation for WO ${order.workOrderId} material ${order.materialCode} on ${prepDocNo}`,
        );
      }
      await this.inv.consumeOccupation(prepDocNo, `${requestId}:consume`, operator);
      order.status = ReworkStatus.ISSUED;
      order.issuePrepDocNo = prepDocNo;
      order.issuedAt = new Date();
      const saved = await this.reworkRepo.save(order);
      await this.audit.log({
        operator,
        action: 'transfer.reworkIssue',
        docNo: order.docNo,
        after: { prepDocNo, issuedAt: order.issuedAt },
        result: 'SUCCESS',
      });
      return saved;
    });
  }

  list(status?: TransferStatus) {
    return this.orderRepo.find({
      where: status ? { status } : {},
      order: { id: 'DESC' },
    });
  }

  detail(id: number) {
    return this.mustGetOrder(id);
  }

  reworkDetail(id: number) {
    return this.mustGetRework(id);
  }

  // ---------- internals ----------

  /** 过账核心：释放源工单 ACTIVE 占用（FIFO 拆分）+ 建立目标工单占用 + 双侧流水 */
  private async doPost(order: TransferOrder, requestId: string, operator: string): Promise<TransferOrder> {
    return this.ds.transaction(async (em) => {
      const occRepo = em.getRepository(StockOccupation);
      const movRepo = em.getRepository(StockMovement);
      const orderRepo = em.getRepository(TransferOrder);

      const actives = await occRepo.find({
        where: {
          workOrderId: order.sourceWorkOrderId,
          materialCode: order.materialCode,
          status: OccupationStatus.ACTIVE,
        },
        order: { id: 'ASC' },
      });
      const total = actives.reduce((s, o) => s + o.qty, 0);
      if (order.qty > total) {
        throw new BizException(
          'TRANSFER_EXCEED',
          `Transfer qty ${order.qty} exceeds ACTIVE occupied ${total}`,
        );
      }
      let remaining = order.qty;
      for (const occ of actives) {
        if (remaining <= 0) break;
        const take = Math.min(occ.qty, remaining);
        occ.qty = Number((occ.qty - take).toFixed(6));
        if (occ.qty <= 0) {
          occ.qty = 0;
          occ.status = OccupationStatus.RELEASED;
        }
        await occRepo.save(occ);
        remaining = Number((remaining - take).toFixed(6));
        await movRepo.save(
          movRepo.create({
            type: MovementType.RELEASE,
            materialCode: order.materialCode,
            qtyChange: 0,
            docNo: order.docNo,
            operator,
            requestId,
            remark: `transfer release ${take} from WO ${order.sourceWorkOrderId} to WO ${order.targetWorkOrderId}`,
          }),
        );
      }
      await occRepo.save(
        occRepo.create({
          workOrderId: order.targetWorkOrderId,
          materialCode: order.materialCode,
          qty: order.qty,
          status: OccupationStatus.ACTIVE,
          prepDocNo: order.docNo,
        }),
      );
      await movRepo.save(
        movRepo.create({
          type: MovementType.OCCUPY,
          materialCode: order.materialCode,
          qtyChange: 0,
          docNo: order.docNo,
          operator,
          requestId,
          remark: `transfer occupy ${order.qty} for WO ${order.targetWorkOrderId} (from WO ${order.sourceWorkOrderId})`,
        }),
      );

      order.status = TransferStatus.POSTED;
      order.postedAt = new Date();
      return orderRepo.save(order);
    });
  }

  private async activeOccupiedQty(workOrderId: string, materialCode: string): Promise<number> {
    const rows = await this.occRepo.find({
      where: { workOrderId, materialCode, status: OccupationStatus.ACTIVE },
    });
    return rows.reduce((s, o) => s + o.qty, 0);
  }

  private async mustGetOrder(id: number): Promise<TransferOrder> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new BizException('TRANSFER_NOT_FOUND', `Transfer ${id} not found`, 404);
    return order;
  }

  private async mustGetRework(id: number): Promise<ReworkOrder> {
    const order = await this.reworkRepo.findOne({ where: { id } });
    if (!order) throw new BizException('REWORK_NOT_FOUND', `Rework ${id} not found`, 404);
    return order;
  }
}
