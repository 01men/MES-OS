import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { InventoryService } from '../inventory/inventory.service';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Bom } from '../masterdata/entities/bom.entity';

export interface KittingLine {
  materialCode: string;
  unit: string;
  requiredQty: number;
  qualifiedQty: number;
  occupiedQty: number;
  safetyStock: number;
  available: number;
  shortageQty: number;
  status: 'OK' | 'SHORTAGE';
  /** 三区域库存可视（仅合格品计入可用） */
  visibility: {
    qualified: number; // 良品仓在库（QUALIFIED）
    pendingInspection: number; // 待检区（PENDING_INSPECTION，不计可用）
    staging: number; // 暂不入库区/备料暂存（STAGING，不计可用）
  };
}

export interface KittingResult {
  workOrderId: string;
  productCode: string;
  planQty: number;
  bomCode: string;
  kitting: boolean;
  status: 'KIT' | 'SHORTAGE';
  shortageLines: { materialCode: string; requiredQty: number; available: number; shortageQty: number }[];
  lines: KittingLine[];
  computedAt: string;
}

/**
 * 齐套检查（REQ-005）：
 * 按工单有效 BOM（productCode 最新版本）逐行计算 需求数 vs InventoryService.available()
 * （可用量 = 合格现存 − 有效占用 − 安全库存；冻结/待检/不良/余料/过期不计）。
 *
 * MVP 重算策略：compute 为实时计算（无缓存陈旧问题）；recompute(workOrderId)
 * 供本模块在 occupy/consume/release 后直连调用（内存事件语义），并刷新内存快照。
 */
@Injectable()
export class KittingService {
  /** 内存快照：recompute 后更新，看板/排查可用 */
  private readonly snapshot = new Map<string, KittingResult>();

  constructor(
    @InjectRepository(WorkOrder)
    private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(Bom)
    private readonly bomRepo: Repository<Bom>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    private readonly inv: InventoryService,
  ) {}

  /** 工单有效 BOM：按 productCode 取最高版本 */
  async effectiveBom(productCode: string): Promise<Bom> {
    const bom = await this.bomRepo.findOne({
      where: { productCode },
      order: { version: 'DESC' },
    });
    if (!bom) {
      throw new BizException('NO_EFFECTIVE_BOM', `No effective BOM for product ${productCode}`, 404);
    }
    return bom;
  }

  /** 实时齐套计算 */
  async compute(workOrderId: string): Promise<KittingResult> {
    const wo = await this.woRepo.findOne({ where: { workOrderId } });
    if (!wo) throw new BizException('WORK_ORDER_NOT_FOUND', `Work order ${workOrderId} not found`, 404);
    const bom = await this.effectiveBom(wo.productCode);

    const lines: KittingLine[] = [];
    for (const item of bom.items ?? []) {
      const requiredQty = item.qty * wo.planQty;
      const avail = await this.inv.available(item.materialCode);
      const lots = await this.lotRepo.find({ where: { materialCode: item.materialCode } });
      const sum = (st: StockStatus) =>
        lots.filter((l) => l.status === st).reduce((s, l) => s + l.qty, 0);
      const shortageQty = Math.max(0, requiredQty - avail.available);
      lines.push({
        materialCode: item.materialCode,
        unit: item.unit,
        requiredQty,
        qualifiedQty: avail.qualifiedQty,
        occupiedQty: avail.occupiedQty,
        safetyStock: avail.safetyStock,
        available: avail.available,
        shortageQty,
        status: shortageQty > 0 ? 'SHORTAGE' : 'OK',
        visibility: {
          qualified: sum(StockStatus.QUALIFIED),
          pendingInspection: sum(StockStatus.PENDING_INSPECTION),
          staging: sum(StockStatus.STAGING),
        },
      });
    }

    const shortageLines = lines
      .filter((l) => l.shortageQty > 0)
      .map((l) => ({
        materialCode: l.materialCode,
        requiredQty: l.requiredQty,
        available: l.available,
        shortageQty: l.shortageQty,
      }));

    const result: KittingResult = {
      workOrderId,
      productCode: wo.productCode,
      planQty: wo.planQty,
      bomCode: bom.bomCode,
      kitting: shortageLines.length === 0,
      status: shortageLines.length === 0 ? 'KIT' : 'SHORTAGE',
      shortageLines,
      lines,
      computedAt: new Date().toISOString(),
    };
    this.snapshot.set(workOrderId, result);
    return result;
  }

  /** 触发重算（库存/工单/BOM/占用变化后由本模块直连调用） */
  async recompute(workOrderId: string): Promise<KittingResult> {
    return this.compute(workOrderId);
  }

  /** 齐套看板：全部工单 + 齐套状态 + 缺料明细 + 三区域库存可视 */
  async board() {
    const wos = await this.woRepo.find({ order: { workOrderId: 'ASC' } });
    const rows = [] as any[];
    for (const wo of wos) {
      try {
        const k = await this.compute(wo.workOrderId);
        rows.push({ workOrderStatus: wo.status, planDate: wo.planDate, ...k });
      } catch (e: any) {
        rows.push({
          workOrderId: wo.workOrderId,
          productCode: wo.productCode,
          planQty: wo.planQty,
          workOrderStatus: wo.status,
          planDate: wo.planDate,
          kitting: false,
          status: 'NO_BOM',
          error: e?.message ?? String(e),
        });
      }
    }
    return rows;
  }
}
