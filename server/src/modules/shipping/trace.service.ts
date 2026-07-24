import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BizException } from '../../common/exceptions';
import { U8Adapter } from '../integration/u8-adapter';
import { StockLot } from '../inventory/entities/stock-lot.entity';
import { WorkOrder } from '../masterdata/entities/work-order.entity';
import { Supplier } from '../masterdata/entities/supplier.entity';
import { Bom } from '../masterdata/entities/bom.entity';
import { DeliveryNote } from './entities/delivery-note.entity';
import { ScanRecord } from './entities/scan-record.entity';
import { SerialNumber } from './entities/serial-number.entity';

/** 缺链路段标注 */
export const THEORETICAL_BOM = '理论 BOM 追溯';

/**
 * 双向追溯（REQ-026）。
 * 链路数据来源：StockLot.workOrderId/sourceDocNo、SerialNumber.workOrderId、发货明细扫码记录；
 * 供应商经 Mock U8 采购订单（materialCode→supplierCode）关联，缺链路段返回 null 并标注「理论 BOM 追溯」。
 */
@Injectable()
export class TraceService {
  constructor(
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(WorkOrder)
    private readonly woRepo: Repository<WorkOrder>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Bom)
    private readonly bomRepo: Repository<Bom>,
    @InjectRepository(DeliveryNote)
    private readonly noteRepo: Repository<DeliveryNote>,
    @InjectRepository(ScanRecord)
    private readonly scanRepo: Repository<ScanRecord>,
    @InjectRepository(SerialNumber)
    private readonly serialRepo: Repository<SerialNumber>,
    private readonly adapter: U8Adapter,
  ) {}

  /** 正向：原料批次 → 工单 → 成品序列号 → 发货单 → 客户 */
  async forward(batchNo: string) {
    if (!batchNo) throw new BizException('BATCH_NO_REQUIRED', 'batchNo is required');
    const lots = await this.lotRepo.find({ where: { batchNo } });
    const workOrders: any[] = [];
    const serials: any[] = [];
    const shipments: any[] = [];
    const seenWo = new Set<string>();
    const seenNote = new Set<number>();

    for (const lot of lots) {
      if (!lot.workOrderId || seenWo.has(lot.workOrderId)) continue;
      seenWo.add(lot.workOrderId);
      const wo = await this.woRepo.findOne({ where: { workOrderId: lot.workOrderId } });
      workOrders.push(
        wo
          ? { workOrderId: wo.workOrderId, productCode: wo.productCode, status: wo.status }
          : { workOrderId: lot.workOrderId, productCode: null, status: null, source: THEORETICAL_BOM },
      );
      const sns = await this.serialRepo.find({ where: { workOrderId: lot.workOrderId } });
      for (const sn of sns) {
        serials.push({ serialNo: sn.serialNo, productCode: sn.productCode, status: sn.status });
        const scans = await this.scanRepo.find({ where: { serialNo: sn.serialNo } });
        for (const sc of scans) {
          if (seenNote.has(sc.noteId)) continue;
          seenNote.add(sc.noteId);
          const note = await this.noteRepo.findOne({ where: { id: sc.noteId } });
          if (note) {
            shipments.push({
              dnNo: note.dnNo,
              status: note.status,
              customerCode: note.customerCode,
              customerName: note.customerName,
              releasedAt: note.releasedAt,
            });
          }
        }
      }
    }

    return {
      direction: 'forward',
      batchNo,
      materials: lots.map((l) => ({
        packageNo: l.packageNo,
        materialCode: l.materialCode,
        workOrderId: l.workOrderId,
        sourceDocNo: l.sourceDocNo,
        receivedAt: l.receivedAt,
      })),
      workOrders,
      serials,
      shipments,
      customer: shipments[0]
        ? { customerCode: shipments[0].customerCode, customerName: shipments[0].customerName }
        : null,
    };
  }

  /** 反向：成品序列号 → 工单 → 原料批次 → 供应商 → 来料日期 */
  async backward(serialNo: string) {
    if (!serialNo) throw new BizException('SERIAL_REQUIRED', 'serialNo is required');
    const serial = await this.serialRepo.findOne({ where: { serialNo } });
    if (!serial) throw new BizException('SERIAL_NOT_FOUND', `序列号 ${serialNo} 不存在`, 404);

    const wo = serial.workOrderId
      ? await this.woRepo.findOne({ where: { workOrderId: serial.workOrderId } })
      : null;

    const lots = serial.workOrderId
      ? await this.lotRepo.find({ where: { workOrderId: serial.workOrderId } })
      : [];

    let batches: any[];
    if (lots.length) {
      batches = await Promise.all(
        lots.map(async (l) => ({
          batchNo: l.batchNo,
          materialCode: l.materialCode,
          packageNo: l.packageNo,
          receivedAt: l.receivedAt, // 来料日期
          source: '批次关联',
          ...(await this.supplierOf(l.materialCode)),
        })),
      );
    } else {
      // 缺链路段：按产品 BOM 给出理论追溯
      const bom = wo
        ? await this.bomRepo.findOne({ where: { productCode: wo.productCode } })
        : null;
      batches = (bom?.items ?? []).map((it) => ({
        batchNo: null,
        materialCode: it.materialCode,
        packageNo: null,
        receivedAt: null,
        source: THEORETICAL_BOM,
        supplierCode: null,
        supplierName: null,
      }));
    }

    const shipment = serial.shippedNoteId
      ? await this.noteRepo.findOne({ where: { id: serial.shippedNoteId } })
      : null;

    return {
      direction: 'backward',
      serialNo: serial.serialNo,
      productCode: serial.productCode,
      status: serial.status,
      workOrder: wo
        ? { workOrderId: wo.workOrderId, productCode: wo.productCode, status: wo.status }
        : serial.workOrderId
          ? { workOrderId: serial.workOrderId, productCode: null, status: null, source: THEORETICAL_BOM }
          : null,
      batches,
      shipment: shipment
        ? { dnNo: shipment.dnNo, customerCode: shipment.customerCode, customerName: shipment.customerName }
        : null,
    };
  }

  /** 追溯链导出（MVP：CSV） */
  async exportCsv(query: { batchNo?: string; serialNo?: string }): Promise<string> {
    const header =
      'direction,key,serialNo,productCode,workOrderId,batchNo,materialCode,supplierCode,supplierName,dnNo,customerCode,customerName,source';
    const rows: string[] = [header];
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    if (query.serialNo) {
      const r = await this.backward(query.serialNo);
      for (const b of r.batches) {
        rows.push(
          [
            'backward', r.serialNo, r.serialNo, r.productCode,
            r.workOrder?.workOrderId ?? '', b.batchNo, b.materialCode,
            b.supplierCode, b.supplierName,
            r.shipment?.dnNo ?? '', r.shipment?.customerCode ?? '', r.shipment?.customerName ?? '',
            b.source,
          ].map(esc).join(','),
        );
      }
      if (!r.batches.length) {
        rows.push(['backward', r.serialNo, r.serialNo, r.productCode, r.workOrder?.workOrderId ?? '', '', '', '', '', '', '', '', ''].map(esc).join(','));
      }
    } else if (query.batchNo) {
      const r = await this.forward(query.batchNo);
      if (!r.materials.length) {
        rows.push(['forward', query.batchNo, '', '', '', query.batchNo, '', '', '', '', '', '', ''].map(esc).join(','));
      }
      for (const m of r.materials) {
        const ship = r.shipments[0];
        rows.push(
          [
            'forward', query.batchNo, r.serials[0]?.serialNo ?? '', r.serials[0]?.productCode ?? '',
            m.workOrderId ?? '', query.batchNo, m.materialCode, '', '',
            ship?.dnNo ?? '', ship?.customerCode ?? '', ship?.customerName ?? '', '批次关联',
          ].map(esc).join(','),
        );
      }
    } else {
      throw new BizException('TRACE_KEY_REQUIRED', 'batchNo 或 serialNo 必填其一');
    }
    return '﻿' + rows.join('\n') + '\n';
  }

  /** 物料 → 供应商（经 U8 采购订单关联）；查不到返回 null 字段 */
  private async supplierOf(materialCode: string): Promise<{ supplierCode: string | null; supplierName: string | null }> {
    const pos = await this.adapter.fetchPurchaseOrders();
    const po = (pos ?? []).find((p: any) =>
      (p.lines ?? []).some((l: any) => l.materialCode === materialCode),
    );
    if (!po) return { supplierCode: null, supplierName: null };
    const sup = await this.supplierRepo.findOne({ where: { supplierCode: po.supplierCode } });
    return { supplierCode: po.supplierCode, supplierName: sup?.name ?? null };
  }
}
