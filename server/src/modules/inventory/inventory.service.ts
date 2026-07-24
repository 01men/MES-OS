import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  MovementType,
  OccupationStatus,
  StockStatus,
} from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { StockLot } from './entities/stock-lot.entity';
import { StockOccupation } from './entities/stock-occupation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Material } from '../masterdata/entities/material.entity';

export interface InboundInput {
  packageNo: string;
  materialCode: string;
  batchNo: string;
  qty: number;
  warehouseCode: string;
  locationCode: string;
  status?: StockStatus; // 默认 QUALIFIED
  workOrderId?: string;
  expiryDate?: Date;
  sourceDocNo: string;
  requestId: string;
  operator?: string;
}

export interface OccupyItem {
  materialCode: string;
  qty: number;
}

export interface AvailableResult {
  materialCode: string;
  warehouseCode?: string;
  qualifiedQty: number;
  occupiedQty: number;
  safetyStock: number;
  available: number;
}

export interface LotFilter {
  materialCode?: string;
  warehouseCode?: string;
  locationCode?: string;
  status?: StockStatus;
  batchNo?: string;
  workOrderId?: string;
}

/**
 * 库存核心服务。契约稳定，下游模块只调用不修改。
 *
 * 可用量公式：available = ΣQUALIFIED.qty − ΣACTIVE占用.qty − material.safetyStock
 * 其余 StockStatus（待检/隔离/余料/备料区/冻结/过期）一律不计入可用量。
 *
 * 所有写方法：事务化 + requestId 幂等（同 requestId 重放返回首次结果，不重复增减）。
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(StockOccupation)
    private readonly occRepo: Repository<StockOccupation>,
    @InjectRepository(StockMovement)
    private readonly movRepo: Repository<StockMovement>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectDataSource()
    private readonly ds: DataSource,
    private readonly idem: IdempotencyService,
  ) {}

  /** 入库：新建批次行（packageNo 唯一） */
  async inbound(input: InboundInput): Promise<StockLot> {
    if (!input.requestId) throw new BizException('REQUEST_ID_REQUIRED', 'requestId is required');
    return this.idem.execute(input.requestId, 'inventory.inbound', async () => {
      return this.ds.transaction(async (em) => {
        const exists = await em.getRepository(StockLot).findOne({
          where: { packageNo: input.packageNo },
        });
        if (exists) {
          throw new BizException('PACKAGE_NO_DUPLICATED', `packageNo ${input.packageNo} already exists`);
        }
        const lot = em.getRepository(StockLot).create({
          packageNo: input.packageNo,
          materialCode: input.materialCode,
          batchNo: input.batchNo,
          warehouseCode: input.warehouseCode,
          locationCode: input.locationCode,
          qty: input.qty,
          status: input.status ?? StockStatus.QUALIFIED,
          workOrderId: input.workOrderId ?? null,
          sourceDocNo: input.sourceDocNo,
          receivedAt: new Date(),
          expiryDate: input.expiryDate ?? null,
        });
        const saved = await em.getRepository(StockLot).save(lot);
        await this.recordMovement(em, {
          type: MovementType.INBOUND,
          packageNo: saved.packageNo,
          materialCode: saved.materialCode,
          qtyChange: saved.qty,
          toStatus: saved.status,
          toLocation: saved.locationCode,
          docNo: input.sourceDocNo,
          operator: input.operator,
          requestId: input.requestId,
        });
        return saved;
      });
    });
  }

  /** 变更批次状态（合格/待检/隔离/余料/备料区/冻结/过期） */
  async changeStatus(
    packageNo: string,
    toStatus: StockStatus,
    docNo: string,
    requestId: string,
    operator?: string,
  ): Promise<StockLot> {
    if (!Object.values(StockStatus).includes(toStatus)) {
      throw new BizException('INVALID_STOCK_STATUS', `Unknown status: ${toStatus}`);
    }
    return this.idem.execute(requestId, 'inventory.changeStatus', async () => {
      return this.ds.transaction(async (em) => {
        const lot = await this.mustGetLot(em, packageNo);
        const fromStatus = lot.status;
        lot.status = toStatus;
        const saved = await em.getRepository(StockLot).save(lot);
        await this.recordMovement(em, {
          type: MovementType.STATUS_CHANGE,
          packageNo,
          materialCode: lot.materialCode,
          qtyChange: 0,
          fromStatus,
          toStatus,
          docNo,
          operator,
          requestId,
        });
        return saved;
      });
    });
  }

  /** 库位移动 */
  async moveLocation(
    packageNo: string,
    toLocation: string,
    docNo: string,
    requestId: string,
    operator?: string,
  ): Promise<StockLot> {
    return this.idem.execute(requestId, 'inventory.moveLocation', async () => {
      return this.ds.transaction(async (em) => {
        const lot = await this.mustGetLot(em, packageNo);
        const fromLocation = lot.locationCode;
        lot.locationCode = toLocation;
        const saved = await em.getRepository(StockLot).save(lot);
        await this.recordMovement(em, {
          type: MovementType.MOVE,
          packageNo,
          materialCode: lot.materialCode,
          qtyChange: 0,
          fromLocation,
          toLocation,
          docNo,
          operator,
          requestId,
        });
        return saved;
      });
    });
  }

  /** 备料占用：按工单占用物料可用量，逐物料校验可用量充足 */
  async occupy(
    workOrderId: string,
    items: OccupyItem[],
    prepDocNo: string,
    requestId: string,
    operator?: string,
  ): Promise<StockOccupation[]> {
    return this.idem.execute(requestId, 'inventory.occupy', async () => {
      return this.ds.transaction(async (em) => {
        const created: StockOccupation[] = [];
        for (const item of items) {
          const avail = await this.availableInTx(em, item.materialCode);
          if (avail.available < item.qty) {
            throw new BizException(
              'INSUFFICIENT_AVAILABLE',
              `Material ${item.materialCode} available ${avail.available} < required ${item.qty}`,
            );
          }
          const occ = await em.getRepository(StockOccupation).save(
            em.getRepository(StockOccupation).create({
              workOrderId,
              materialCode: item.materialCode,
              qty: item.qty,
              status: OccupationStatus.ACTIVE,
              prepDocNo,
            }),
          );
          created.push(occ);
          await this.recordMovement(em, {
            type: MovementType.OCCUPY,
            materialCode: item.materialCode,
            qtyChange: 0,
            docNo: prepDocNo,
            operator,
            requestId,
            remark: `occupy ${item.qty} for WO ${workOrderId}`,
          });
        }
        return created;
      });
    });
  }

  /** 释放占用（备料取消等）：ACTIVE → RELEASED，可用量回升 */
  async releaseOccupation(prepDocNo: string, requestId?: string, operator?: string): Promise<number> {
    const run = async () =>
      this.ds.transaction(async (em) => {
        const actives = await em.getRepository(StockOccupation).find({
          where: { prepDocNo, status: OccupationStatus.ACTIVE },
        });
        for (const occ of actives) {
          occ.status = OccupationStatus.RELEASED;
          await em.getRepository(StockOccupation).save(occ);
          await this.recordMovement(em, {
            type: MovementType.RELEASE,
            materialCode: occ.materialCode,
            qtyChange: 0,
            docNo: prepDocNo,
            operator,
            requestId,
            remark: `release ${occ.qty} (WO ${occ.workOrderId})`,
          });
        }
        return actives.length;
      });
    return requestId ? this.idem.execute(requestId, 'inventory.releaseOccupation', run) : run();
  }

  /**
   * 核销占用（交接出库）：ACTIVE → CONSUMED，并按 receivedAt 先进先出
   * 扣减对应物料的实物批次库存（先 STAGING 备料区批次，后 QUALIFIED 批次）。
   */
  async consumeOccupation(
    prepDocNo: string,
    requestId?: string,
    operator?: string,
  ): Promise<StockOccupation[]> {
    const run = async () =>
      this.ds.transaction(async (em) => {
        const actives = await em.getRepository(StockOccupation).find({
          where: { prepDocNo, status: OccupationStatus.ACTIVE },
        });
        for (const occ of actives) {
          let remaining = occ.qty;
          const lots = await em.getRepository(StockLot).find({
            where: [
              { materialCode: occ.materialCode, status: StockStatus.STAGING },
              { materialCode: occ.materialCode, status: StockStatus.QUALIFIED },
            ],
            order: { receivedAt: 'ASC' },
          });
          for (const lot of lots) {
            if (remaining <= 0) break;
            if (lot.qty <= 0) continue;
            const take = Math.min(lot.qty, remaining);
            lot.qty -= take;
            remaining -= take;
            await em.getRepository(StockLot).save(lot);
            await this.recordMovement(em, {
              type: MovementType.CONSUME,
              packageNo: lot.packageNo,
              materialCode: lot.materialCode,
              qtyChange: -take,
              fromStatus: lot.status,
              docNo: prepDocNo,
              operator,
              requestId,
              remark: `consume for WO ${occ.workOrderId}`,
            });
          }
          if (remaining > 0) {
            throw new BizException(
              'INSUFFICIENT_PHYSICAL_STOCK',
              `Material ${occ.materialCode} short of physical stock by ${remaining}`,
            );
          }
          occ.status = OccupationStatus.CONSUMED;
          await em.getRepository(StockOccupation).save(occ);
        }
        return actives;
      });
    return requestId ? this.idem.execute(requestId, 'inventory.consumeOccupation', run) : run();
  }

  /** 盘点调整：把批次数量调整为 newQty，记流水 */
  async adjust(
    packageNo: string,
    newQty: number,
    reason: string,
    docNo: string,
    requestId: string,
    operator?: string,
  ): Promise<StockLot> {
    if (newQty < 0) throw new BizException('INVALID_QTY', 'newQty must be >= 0');
    return this.idem.execute(requestId, 'inventory.adjust', async () => {
      return this.ds.transaction(async (em) => {
        const lot = await this.mustGetLot(em, packageNo);
        const delta = newQty - lot.qty;
        lot.qty = newQty;
        const saved = await em.getRepository(StockLot).save(lot);
        await this.recordMovement(em, {
          type: MovementType.ADJUST,
          packageNo,
          materialCode: lot.materialCode,
          qtyChange: delta,
          docNo,
          operator,
          requestId,
          remark: reason,
        });
        return saved;
      });
    });
  }

  /**
   * 可用量查询：ΣQUALIFIED.qty − ΣACTIVE占用.qty − safetyStock
   */
  async available(materialCode: string, warehouseCode?: string): Promise<AvailableResult> {
    return this.availableInTx(this.ds.manager, materialCode, warehouseCode);
  }

  /** 批次查询 */
  async queryLots(filter: LotFilter): Promise<StockLot[]> {
    const qb = this.lotRepo.createQueryBuilder('l').orderBy('l.receivedAt', 'ASC');
    if (filter.materialCode) qb.andWhere('l.materialCode = :materialCode', filter);
    if (filter.warehouseCode) qb.andWhere('l.warehouseCode = :warehouseCode', filter);
    if (filter.locationCode) qb.andWhere('l.locationCode = :locationCode', filter);
    if (filter.status) qb.andWhere('l.status = :status', filter);
    if (filter.batchNo) qb.andWhere('l.batchNo = :batchNo', filter);
    if (filter.workOrderId) qb.andWhere('l.workOrderId = :workOrderId', filter);
    return qb.getMany();
  }

  // ---------- internals ----------

  private async availableInTx(
    em: EntityManager,
    materialCode: string,
    warehouseCode?: string,
  ): Promise<AvailableResult> {
    const lotQb = em
      .getRepository(StockLot)
      .createQueryBuilder('l')
      .select('COALESCE(SUM(l.qty), 0)', 'sum')
      .where('l.materialCode = :materialCode', { materialCode })
      .andWhere('l.status = :st', { st: StockStatus.QUALIFIED });
    if (warehouseCode) lotQb.andWhere('l.warehouseCode = :warehouseCode', { warehouseCode });
    const qualifiedQty = Number((await lotQb.getRawOne())?.sum ?? 0);

    const occQb = em
      .getRepository(StockOccupation)
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.qty), 0)', 'sum')
      .where('o.materialCode = :materialCode', { materialCode })
      .andWhere('o.status = :os', { os: OccupationStatus.ACTIVE });
    const occupiedQty = Number((await occQb.getRawOne())?.sum ?? 0);

    const material = await em.getRepository(Material).findOne({ where: { materialCode } });
    const safetyStock = material?.safetyStock ?? 0;

    return {
      materialCode,
      warehouseCode,
      qualifiedQty,
      occupiedQty,
      safetyStock,
      available: qualifiedQty - occupiedQty - safetyStock,
    };
  }

  private async mustGetLot(em: EntityManager, packageNo: string): Promise<StockLot> {
    const lot = await em.getRepository(StockLot).findOne({ where: { packageNo } });
    if (!lot) throw new BizException('LOT_NOT_FOUND', `packageNo ${packageNo} not found`, 404);
    return lot;
  }

  private async recordMovement(
    em: EntityManager,
    m: Partial<StockMovement> & { type: MovementType; materialCode: string; docNo: string },
  ): Promise<StockMovement> {
    return em.getRepository(StockMovement).save(em.getRepository(StockMovement).create(m));
  }
}
