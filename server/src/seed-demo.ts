import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './database';
import { seedData } from './seed';
import { AbcClass, OccupationStatus, StockStatus, DocStatus } from './common/enums';
import { Material } from './modules/masterdata/entities/material.entity';
import { WorkOrder } from './modules/masterdata/entities/work-order.entity';
import { Bom } from './modules/masterdata/entities/bom.entity';
import { StockLot } from './modules/inventory/entities/stock-lot.entity';
import { StockOccupation } from './modules/inventory/entities/stock-occupation.entity';
import {
  RcvPurchaseOrder,
  RcvPurchaseOrderLine,
} from './modules/receiving/entities/purchase-order.entity';
import {
  ArrivalStatus,
  CountMode,
  IqcDecision,
  ReceivingArrival,
} from './modules/receiving/entities/receiving-arrival.entity';
import { PrepOrder } from './modules/prep/entities/prep-order.entity';
import { PrepOrderLine } from './modules/prep/entities/prep-order-line.entity';
import {
  SurplusRecord,
  SurplusSourceType,
} from './modules/surplus/entities/surplus-record.entity';
import {
  StocktakeScopeType,
  StocktakeStrategy,
} from './modules/stocktake/entities/stocktake-strategy.entity';
import {
  StocktakeTask,
  StocktakeTaskStatus,
  StocktakeTaskType,
} from './modules/stocktake/entities/stocktake-task.entity';
import { DeliveryNote } from './modules/shipping/entities/delivery-note.entity';
import { DeliveryNoteLine } from './modules/shipping/entities/delivery-note-line.entity';
import { SerialNumber } from './modules/shipping/entities/serial-number.entity';

/**
 * 演示数据（阶段七）：在 `npm run seed` 基础上造一套可演示全链路的业务数据。
 * 全部使用固定单号 + 先查后插，重复执行幂等（已存在则跳过）。
 * 直接操作 EntityManager/Repository，串行 await（sqljs 单连接不支持并发事务）。
 */
export async function seedDemoData(ds: DataSource) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // ---- 0. 成品物料（主数据补充） ----
  const matRepo = ds.getRepository(Material);
  if (!(await matRepo.findOne({ where: { materialCode: 'P-9001' } }))) {
    await matRepo.save(
      matRepo.create({
        materialCode: 'P-9001',
        name: '电热水壶成品',
        abcClass: AbcClass.A,
        safetyStock: 0,
        unit: 'PCS',
        shelfLifeDays: null,
        isSpecial: false,
        specialStatus: 'NORMAL',
      }),
    );
  }

  // ---- 1. 采购订单 + 到货单（已 IQC 入库，生成 QUALIFIED 批次库存） ----
  const poRepo = ds.getRepository(RcvPurchaseOrder);
  if (!(await poRepo.findOne({ where: { poNo: 'PO-DEMO-001' } }))) {
    await poRepo.save(
      poRepo.create({ poNo: 'PO-DEMO-001', supplierCode: 'SUP001', status: 'OPEN' }),
    );
    await ds.getRepository(RcvPurchaseOrderLine).save(
      ds.getRepository(RcvPurchaseOrderLine).create({
        poNo: 'PO-DEMO-001',
        materialCode: 'M-1002',
        qty: 200,
        receivedQty: 200,
        unit: 'PCS',
      }),
    );
  }

  const arrRepo = ds.getRepository(ReceivingArrival);
  if (!(await arrRepo.findOne({ where: { arrivalNo: 'RCV-DEMO-001' } }))) {
    await arrRepo.save(
      arrRepo.create({
        arrivalNo: 'RCV-DEMO-001',
        poNo: 'PO-DEMO-001',
        materialCode: 'M-1002',
        qty: 200,
        scannedQty: 200,
        orderQty: 200,
        supplierCode: 'SUP001',
        batchNo: 'LOT-DEMO-001',
        packageNo: 'PKG-DEMO-0001',
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        abcClass: AbcClass.B,
        countMode: CountMode.SAMPLE,
        status: ArrivalStatus.CONFIRMED,
        iqcDecision: IqcDecision.ALL,
        qualifiedQty: 200,
        rejectedQty: 0,
        concessionQty: 0,
        pendingQty: 0,
        isOutsource: false,
        postings: JSON.stringify([
          {
            packageNo: 'PKG-DEMO-0001',
            qty: 200,
            status: 'QUALIFIED',
            concession: false,
            isOutsource: false,
            sourcePoNo: 'PO-DEMO-001',
            supplierCode: 'SUP001',
          },
        ]),
        syncStatus: DocStatus.SYNCED,
      }),
    );
  }

  const lotRepo = ds.getRepository(StockLot);
  if (!(await lotRepo.findOne({ where: { packageNo: 'PKG-DEMO-0001' } }))) {
    await lotRepo.save(
      lotRepo.create({
        packageNo: 'PKG-DEMO-0001',
        materialCode: 'M-1002',
        batchNo: 'LOT-DEMO-001',
        warehouseCode: 'WH01',
        locationCode: 'WH01-A-01',
        qty: 200,
        status: StockStatus.QUALIFIED,
        workOrderId: null,
        sourceDocNo: 'RCV-DEMO-001',
        receivedAt: now,
        expiryDate: null,
      }),
    );
  }

  // ---- 2. 工单 + BOM + 已齐套备料单（含库存占用） ----
  const woRepo = ds.getRepository(WorkOrder);
  if (!(await woRepo.findOne({ where: { workOrderId: 'WO-DEMO-001' } }))) {
    await woRepo.save(
      woRepo.create({
        workOrderId: 'WO-DEMO-001',
        productCode: 'P-9001',
        planQty: 10,
        planDate: today,
        status: 'RELEASED',
      }),
    );
  }

  const bomRepo = ds.getRepository(Bom);
  if (!(await bomRepo.findOne({ where: { bomCode: 'BOM-DEMO-P9001' } }))) {
    await bomRepo.save(
      bomRepo.create({
        bomCode: 'BOM-DEMO-P9001',
        productCode: 'P-9001',
        version: 1,
        items: [
          { bomCode: 'BOM-DEMO-P9001', materialCode: 'M-1001', qty: 1, unit: 'PCS' },
          { bomCode: 'BOM-DEMO-P9001', materialCode: 'M-1002', qty: 2, unit: 'PCS' },
        ] as any,
      }),
    );
  }

  const prepRepo = ds.getRepository(PrepOrder);
  if (!(await prepRepo.findOne({ where: { prepDocNo: 'PREP-DEMO-001' } }))) {
    await prepRepo.save(
      prepRepo.create({
        prepDocNo: 'PREP-DEMO-001',
        taskNo: 'PT-DEMO-001',
        workOrderId: 'WO-DEMO-001',
        status: DocStatus.APPROVED,
      }),
    );
    // 齐套：requiredQty == preparedQty
    const lineRepo = ds.getRepository(PrepOrderLine);
    await lineRepo.save(
      lineRepo.create({ prepDocNo: 'PREP-DEMO-001', materialCode: 'M-1001', requiredQty: 10, preparedQty: 10, unit: 'PCS' }),
    );
    await lineRepo.save(
      lineRepo.create({ prepDocNo: 'PREP-DEMO-001', materialCode: 'M-1002', requiredQty: 20, preparedQty: 20, unit: 'PCS' }),
    );
    const occRepo = ds.getRepository(StockOccupation);
    await occRepo.save(
      occRepo.create({ workOrderId: 'WO-DEMO-001', materialCode: 'M-1001', qty: 10, status: OccupationStatus.ACTIVE, prepDocNo: 'PREP-DEMO-001' }),
    );
    await occRepo.save(
      occRepo.create({ workOrderId: 'WO-DEMO-001', materialCode: 'M-1002', qty: 20, status: OccupationStatus.ACTIVE, prepDocNo: 'PREP-DEMO-001' }),
    );
  }

  // ---- 3. 一条 YL 余料（整包入余料区，独立记账） ----
  const surRepo = ds.getRepository(SurplusRecord);
  if (!(await surRepo.findOne({ where: { docNo: 'SUR-DEMO-001' } }))) {
    await surRepo.save(
      surRepo.create({
        docNo: 'SUR-DEMO-001',
        packageNo: 'PKG-DEMO-YL01',
        sourceType: SurplusSourceType.SUPPLIER_EXTRA,
        sourceDocNo: 'PO-DEMO-001',
        materialCode: 'M-1001',
        materialName: '电源线',
        originalQty: 20,
        qty: 20,
        occurredAt: now,
        responsible: 'keeper01',
        workOrderId: null,
        warehouseCode: 'WH01',
        originLocation: 'WH01-A-01',
        createdBy: 'keeper01',
      }),
    );
  }
  if (!(await lotRepo.findOne({ where: { packageNo: 'PKG-DEMO-YL01' } }))) {
    await lotRepo.save(
      lotRepo.create({
        packageNo: 'PKG-DEMO-YL01',
        materialCode: 'M-1001',
        batchNo: 'LOT-DEMO-YL01',
        warehouseCode: 'WH01',
        locationCode: 'WH01-YL-01',
        qty: 20,
        status: StockStatus.SURPLUS_YL,
        workOrderId: null,
        sourceDocNo: 'SUR-DEMO-001',
        receivedAt: now,
        expiryDate: null,
      }),
    );
  }

  // ---- 4. 盘点策略 + 当日盘点任务 ----
  const stgRepo = ds.getRepository(StocktakeStrategy);
  let strategy = await stgRepo.findOne({ where: { name: 'A类物料月盘' } });
  if (!strategy) {
    strategy = await stgRepo.save(
      stgRepo.create({
        name: 'A类物料月盘',
        scopeType: StocktakeScopeType.ABC,
        scopeValue: 'A',
        cycleDays: 30,
        ownerUserId: 'keeper01',
        active: true,
      }),
    );
  }
  const taskRepo = ds.getRepository(StocktakeTask);
  if (
    !(await taskRepo.findOne({
      where: { strategyId: strategy.id, generatedDate: today },
    }))
  ) {
    await taskRepo.save(
      taskRepo.create({
        taskNo: 'STK-DEMO-001',
        taskType: StocktakeTaskType.CYCLE,
        strategyId: strategy.id,
        generatedDate: today,
        status: StocktakeTaskStatus.OPEN,
        blind: true,
        ownerUserId: 'keeper01',
      }),
    );
  }

  // ---- 5. 发货单 + 3 个成品序列号 ----
  const dnRepo = ds.getRepository(DeliveryNote);
  let note = await dnRepo.findOne({ where: { dnNo: 'SHP-DEMO-001' } });
  if (!note) {
    note = await dnRepo.save(
      dnRepo.create({
        dnNo: 'SHP-DEMO-001',
        customerCode: 'CUS001',
        customerName: '苏泊尔',
        source: 'SALES',
        status: DocStatus.DRAFT,
      }),
    );
    await ds.getRepository(DeliveryNoteLine).save(
      ds.getRepository(DeliveryNoteLine).create({
        noteId: note.id,
        orderNo: 'SO-DEMO-001',
        productCode: 'P-9001',
        qty: 3,
        unit: 'PCS',
        sortOrder: 0,
      }),
    );
  }
  const snRepo = ds.getRepository(SerialNumber);
  for (const sn of ['SN-DEMO-0001', 'SN-DEMO-0002', 'SN-DEMO-0003']) {
    if (!(await snRepo.findOne({ where: { serialNo: sn } }))) {
      await snRepo.save(
        snRepo.create({
          serialNo: sn,
          productCode: 'P-9001',
          batchNo: 'PB-DEMO-001',
          workOrderId: 'WO-DEMO-001',
          status: 'IN_STOCK',
        }),
      );
    }
  }

  return { ok: true };
}

/** CLI 入口：npm run seed:demo（先跑基础 seed 再造演示数据） */
async function main() {
  const ds = new DataSource(buildTypeOrmOptions(false) as any);
  await ds.initialize();
  await seedData(ds);
  await seedDemoData(ds);
  await ds.destroy();
  // eslint-disable-next-line no-console
  console.log(
    'Demo seed done: PO-DEMO-001 / RCV-DEMO-001 / WO-DEMO-001 / PREP-DEMO-001 / SUR-DEMO-001 / STK-DEMO-001 / SHP-DEMO-001 / SN-DEMO-0001~0003',
  );
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
