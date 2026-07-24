import 'reflect-metadata';
import { DataSource, Like } from 'typeorm';
import { buildTypeOrmOptions } from './database';
import { seedData } from './seed';
import { AbcClass, DocStatus, OccupationStatus, StockStatus } from './common/enums';
import { AuditLog } from './common/audit/audit.entity';
import { WorkOrder } from './modules/masterdata/entities/work-order.entity';
import { StockLot } from './modules/inventory/entities/stock-lot.entity';
import { StockOccupation } from './modules/inventory/entities/stock-occupation.entity';
import { RcvPurchaseOrder, RcvPurchaseOrderLine } from './modules/receiving/entities/purchase-order.entity';
import {
  ArrivalStatus,
  CountMode,
  IqcDecision,
  ReceivingArrival,
} from './modules/receiving/entities/receiving-arrival.entity';
import { PrepOrder } from './modules/prep/entities/prep-order.entity';
import { PrepOrderLine } from './modules/prep/entities/prep-order-line.entity';
import { DeliveryNote } from './modules/shipping/entities/delivery-note.entity';
import { DeliveryNoteLine } from './modules/shipping/entities/delivery-note-line.entity';
import { SerialNumber } from './modules/shipping/entities/serial-number.entity';
import { SyncTask } from './modules/integration/sync-task.entity';
import { U8Voucher } from './modules/integration/u8-voucher.entity';

const PREFIX = 'SIM';
const OPERATOR = 'receiver01';
const CHUNK = 100;
const code = (index: number) => String(index).padStart(6, '0');

/**
 * Creates linked business scenarios, not isolated rows:
 * U8 PO -> receiving/IQC -> inventory lot -> work order -> preparation/occupation
 * -> finished serial/delivery -> U8 sync task/voucher.
 *
 * Every generated identifier uses the SIM namespace. Existing user data is never
 * deleted or overwritten, and reruns only repair missing portions of a scenario.
 */
export async function seedVolumeData(ds: DataSource, count = 1000) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new Error('count must be an integer between 1 and 10000');
  }
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const poRepo = ds.getRepository(RcvPurchaseOrder);
  const poLineRepo = ds.getRepository(RcvPurchaseOrderLine);
  const arrivalRepo = ds.getRepository(ReceivingArrival);
  const lotRepo = ds.getRepository(StockLot);
  const woRepo = ds.getRepository(WorkOrder);
  const prepRepo = ds.getRepository(PrepOrder);
  const prepLineRepo = ds.getRepository(PrepOrderLine);
  const occupationRepo = ds.getRepository(StockOccupation);
  const deliveryRepo = ds.getRepository(DeliveryNote);
  const deliveryLineRepo = ds.getRepository(DeliveryNoteLine);
  const serialRepo = ds.getRepository(SerialNumber);
  const taskRepo = ds.getRepository(SyncTask);
  const voucherRepo = ds.getRepository(U8Voucher);

  const existing = {
    po: new Set((await poRepo.find({ where: { poNo: Like(`PO-${PREFIX}-%`) } })).map((x) => x.poNo)),
    poLine: new Set((await poLineRepo.find({ where: { poNo: Like(`PO-${PREFIX}-%`) } })).map((x) => x.poNo)),
    arrival: new Set((await arrivalRepo.find({ where: { arrivalNo: Like(`RCV-${PREFIX}-%`) } })).map((x) => x.arrivalNo)),
    lot: new Set((await lotRepo.find({ where: { packageNo: Like(`PKG-${PREFIX}-%`) } })).map((x) => x.packageNo)),
    workOrder: new Set((await woRepo.find({ where: { workOrderId: Like(`WO-${PREFIX}-%`) } })).map((x) => x.workOrderId)),
    prep: new Set((await prepRepo.find({ where: { prepDocNo: Like(`PREP-${PREFIX}-%`) } })).map((x) => x.prepDocNo)),
    prepLine: new Set((await prepLineRepo.find({ where: { prepDocNo: Like(`PREP-${PREFIX}-%`) } })).map((x) => x.prepDocNo)),
    occupation: new Set((await occupationRepo.find({ where: { prepDocNo: Like(`PREP-${PREFIX}-%`) } })).map((x) => x.prepDocNo)),
    delivery: new Set((await deliveryRepo.find({ where: { dnNo: Like(`SHP-${PREFIX}-%`) } })).map((x) => x.dnNo)),
    serial: new Set((await serialRepo.find({ where: { serialNo: Like(`SN-${PREFIX}-%`) } })).map((x) => x.serialNo)),
    task: new Set((await taskRepo.find({ where: { bizKey: Like(`RCV-${PREFIX}-%`) } })).map((x) => x.bizKey)),
    voucher: new Set((await voucherRepo.find({ where: { bizKey: Like(`RCV-${PREFIX}-%`) } })).map((x) => x.bizKey)),
  };

  const rows = {
    po: [] as RcvPurchaseOrder[],
    poLine: [] as RcvPurchaseOrderLine[],
    arrival: [] as ReceivingArrival[],
    lot: [] as StockLot[],
    workOrder: [] as WorkOrder[],
    prep: [] as PrepOrder[],
    prepLine: [] as PrepOrderLine[],
    occupation: [] as StockOccupation[],
    delivery: [] as DeliveryNote[],
    serial: [] as SerialNumber[],
    task: [] as SyncTask[],
    voucher: [] as U8Voucher[],
  };

  for (let index = 1; index <= count; index += 1) {
    const suffix = code(index);
    const poNo = `PO-${PREFIX}-${suffix}`;
    const arrivalNo = `RCV-${PREFIX}-${suffix}`;
    const packageNo = `PKG-${PREFIX}-${suffix}`;
    const workOrderId = `WO-${PREFIX}-${suffix}`;
    const prepDocNo = `PREP-${PREFIX}-${suffix}`;
    const dnNo = `SHP-${PREFIX}-${suffix}`;
    const serialNo = `SN-${PREFIX}-${suffix}`;
    const materialCode = index % 2 ? 'M-1001' : 'M-1002';
    const qty = 20 + (index % 31);

    if (!existing.po.has(poNo)) rows.po.push(poRepo.create({
      poNo,
      supplierCode: index % 4 === 0 ? 'SUP002' : 'SUP001',
      orderType: index % 10 === 0 ? 'OUTSOURCE' : 'NORMAL',
      status: 'OPEN',
      sourceUpdatedAt: now.toISOString(),
    }));
    if (!existing.poLine.has(poNo)) rows.poLine.push(poLineRepo.create({
      poNo, materialCode, qty, receivedQty: qty, unit: 'PCS',
    }));
    if (!existing.arrival.has(arrivalNo)) rows.arrival.push(arrivalRepo.create({
      arrivalNo,
      poNo,
      materialCode,
      qty,
      scannedQty: qty,
      orderQty: qty,
      supplierCode: index % 4 === 0 ? 'SUP002' : 'SUP001',
      batchNo: `LOT-${PREFIX}-${suffix}`,
      packageNo,
      warehouseCode: 'WH01',
      locationCode: 'WH01-A-01',
      abcClass: index % 2 ? AbcClass.A : AbcClass.B,
      countMode: index % 2 ? CountMode.FULL : CountMode.SAMPLE,
      status: ArrivalStatus.CONFIRMED,
      iqcDecision: IqcDecision.ALL,
      qualifiedQty: qty,
      rejectedQty: 0,
      concessionQty: 0,
      pendingQty: 0,
      isOutsource: index % 10 === 0,
      workOrderId,
      postings: JSON.stringify([{
        packageNo,
        qty,
        status: StockStatus.QUALIFIED,
        concession: false,
        isOutsource: index % 10 === 0,
        sourcePoNo: poNo,
        supplierCode: index % 4 === 0 ? 'SUP002' : 'SUP001',
      }]),
      syncStatus: DocStatus.SYNCED,
    }));
    if (!existing.lot.has(packageNo)) rows.lot.push(lotRepo.create({
      packageNo,
      materialCode,
      batchNo: `LOT-${PREFIX}-${suffix}`,
      warehouseCode: 'WH01',
      locationCode: 'WH01-A-01',
      qty,
      status: StockStatus.QUALIFIED,
      workOrderId,
      sourceDocNo: arrivalNo,
      receivedAt: now,
      expiryDate: null,
    }));
    if (!existing.workOrder.has(workOrderId)) rows.workOrder.push(woRepo.create({
      workOrderId,
      productCode: 'P-9001',
      planQty: 1 + (index % 10),
      planDate: today,
      status: index % 5 === 0 ? 'COMPLETED' : 'RELEASED',
    }));
    if (!existing.prep.has(prepDocNo)) rows.prep.push(prepRepo.create({
      prepDocNo,
      taskNo: `PT-${PREFIX}-${suffix}`,
      workOrderId,
      status: DocStatus.SYNCED,
      keeperBy: 'keeper01',
      keeperAt: now,
      keeperDevice: 'SIMULATOR',
      receiverBy: OPERATOR,
      receiverAt: now,
      receiverDevice: 'SIMULATOR',
      postedAt: now,
    }));
    if (!existing.prepLine.has(prepDocNo)) rows.prepLine.push(prepLineRepo.create({
      prepDocNo, materialCode, requiredQty: 1, preparedQty: 1, unit: 'PCS',
    }));
    if (!existing.occupation.has(prepDocNo)) rows.occupation.push(occupationRepo.create({
      workOrderId,
      materialCode,
      warehouseCode: 'WH01',
      qty: 1,
      status: OccupationStatus.CONSUMED,
      prepDocNo,
    }));
    if (!existing.delivery.has(dnNo)) rows.delivery.push(deliveryRepo.create({
      dnNo,
      customerCode: index % 3 === 0 ? 'CUS002' : 'CUS001',
      customerName: `模拟客户${(index % 3) + 1}`,
      source: 'U8',
      status: index % 5 === 0 ? DocStatus.SYNCED : DocStatus.DRAFT,
      keeperConfirmBy: index % 5 === 0 ? 'keeper01' : null,
      keeperConfirmAt: index % 5 === 0 ? now : null,
      driverName: index % 5 === 0 ? `模拟司机${index % 8}` : null,
      driverConfirmAt: index % 5 === 0 ? now : null,
      releasedAt: index % 5 === 0 ? now : null,
      u8UpdatedAt: now.toISOString(),
    }));
    if (!existing.serial.has(serialNo)) rows.serial.push(serialRepo.create({
      serialNo,
      productCode: 'P-9001',
      batchNo: `PB-${PREFIX}-${suffix}`,
      workOrderId,
      status: 'IN_STOCK',
    }));
    if (!existing.task.has(arrivalNo)) rows.task.push(taskRepo.create({
      bizType: 'receiving',
      bizKey: arrivalNo,
      voucherType: 'RECEIVE',
      payload: JSON.stringify({ poNo, arrivalNo, packageNo, materialCode, qty }),
      status: DocStatus.SYNCED,
      attempts: 0,
    }));
    if (!existing.voucher.has(arrivalNo)) rows.voucher.push(voucherRepo.create({
      voucherType: 'RECEIVE',
      bizKey: arrivalNo,
      payload: JSON.stringify({ poNo, arrivalNo, packageNo, materialCode, qty }),
    }));
  }

  await poRepo.save(rows.po, { chunk: CHUNK });
  await poLineRepo.save(rows.poLine, { chunk: CHUNK });
  await arrivalRepo.save(rows.arrival, { chunk: CHUNK });
  await lotRepo.save(rows.lot, { chunk: CHUNK });
  await woRepo.save(rows.workOrder, { chunk: CHUNK });
  await prepRepo.save(rows.prep, { chunk: CHUNK });
  await prepLineRepo.save(rows.prepLine, { chunk: CHUNK });
  await occupationRepo.save(rows.occupation, { chunk: CHUNK });
  await deliveryRepo.save(rows.delivery, { chunk: CHUNK });

  const allDeliveries = await deliveryRepo.find({ where: { dnNo: Like(`SHP-${PREFIX}-%`) } });
  const allDeliveryIds = new Map(allDeliveries.map((note) => [note.dnNo, note.id]));
  const generatedNoteIds = new Set(allDeliveryIds.values());
  const existingDeliveryLines = new Set(
    (await deliveryLineRepo.find())
      .filter((line) => generatedNoteIds.has(line.noteId))
      .map((line) => line.noteId),
  );
  const deliveryLines = allDeliveries
    .filter((note) => !existingDeliveryLines.has(note.id))
    .map((note) => deliveryLineRepo.create({
      noteId: note.id,
      orderNo: `SO-${note.dnNo.slice(-6)}`,
      productCode: 'P-9001',
      qty: 1,
      unit: 'PCS',
      sortOrder: 0,
    }));
  await deliveryLineRepo.save(deliveryLines, { chunk: CHUNK });
  await serialRepo.save(rows.serial, { chunk: CHUNK });
  await taskRepo.save(rows.task, { chunk: CHUNK });
  await voucherRepo.save(rows.voucher, { chunk: CHUNK });

  const auditRepo = ds.getRepository(AuditLog);
  const auditDocNo = `${PREFIX}-VOLUME-${count}`;
  if (!(await auditRepo.findOne({ where: { action: 'seed.volume', docNo: auditDocNo } }))) {
    await auditRepo.save(auditRepo.create({
      operator: OPERATOR,
      role: 'RECEIVER',
      device: 'SIMULATOR',
      action: 'seed.volume',
      docNo: auditDocNo,
      before: null,
      after: JSON.stringify({ scenarioCount: count, namespace: PREFIX, inserted: Object.fromEntries(
        Object.entries(rows).map(([key, value]) => [key, value.length]),
      ) }),
      result: 'SUCCESS',
    }));
  }

  const totals = {
    purchaseOrders: await poRepo.count({ where: { poNo: Like(`PO-${PREFIX}-%`) } }),
    arrivals: await arrivalRepo.count({ where: { arrivalNo: Like(`RCV-${PREFIX}-%`) } }),
    inventoryLots: await lotRepo.count({ where: { packageNo: Like(`PKG-${PREFIX}-%`) } }),
    workOrders: await woRepo.count({ where: { workOrderId: Like(`WO-${PREFIX}-%`) } }),
    prepOrders: await prepRepo.count({ where: { prepDocNo: Like(`PREP-${PREFIX}-%`) } }),
    deliveryNotes: await deliveryRepo.count({ where: { dnNo: Like(`SHP-${PREFIX}-%`) } }),
    serialNumbers: await serialRepo.count({ where: { serialNo: Like(`SN-${PREFIX}-%`) } }),
    u8SyncTasks: await taskRepo.count({ where: { bizKey: Like(`RCV-${PREFIX}-%`) } }),
  };
  const incomplete = Object.entries(totals).filter(([, value]) => value < count);
  if (incomplete.length) throw new Error(`Volume seed referential validation failed: ${JSON.stringify(incomplete)}`);
  return { scenarioCount: count, operator: OPERATOR, totals };
}

async function main() {
  const countArg = process.argv.find((arg) => arg.startsWith('--count='));
  const count = Number(countArg?.split('=')[1] ?? process.env.MES_MOCK_COUNT ?? 1000);
  const ds = new DataSource(buildTypeOrmOptions(false) as any);
  await ds.initialize();
  await seedData(ds);
  const report = await seedVolumeData(ds, count);
  await ds.destroy();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
