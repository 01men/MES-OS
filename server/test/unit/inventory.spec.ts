import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { IdempotencyRecord } from '../../src/common/idempotency/idempotency.entity';
import { StockLot } from '../../src/modules/inventory/entities/stock-lot.entity';
import { StockOccupation } from '../../src/modules/inventory/entities/stock-occupation.entity';
import { StockMovement } from '../../src/modules/inventory/entities/stock-movement.entity';
import { Material } from '../../src/modules/masterdata/entities/material.entity';
import { Location } from '../../src/modules/masterdata/entities/location.entity';
import { MovementType, OccupationStatus, StockStatus } from '../../src/common/enums';

describe('InventoryService 库存核心', () => {
  let ds: DataSource;
  let inv: InventoryService;
  let movRepo: any;
  let occRepo: any;
  let lotRepo: any;

  const inbound = (over: Partial<any> = {}) =>
    inv.inbound({
      packageNo: 'PKG-1',
      materialCode: 'M1',
      batchNo: 'B1',
      qty: 100,
      warehouseCode: 'WH01',
      locationCode: 'WH01-A-01',
      sourceDocNo: 'RCV-1',
      requestId: 'rid-in-1',
      ...over,
    });

  beforeEach(async () => {
    ds = await createTestDataSource();
    lotRepo = ds.getRepository(StockLot);
    occRepo = ds.getRepository(StockOccupation);
    movRepo = ds.getRepository(StockMovement);
    const materialRepo = ds.getRepository(Material);
    const locationRepo = ds.getRepository(Location);
    await materialRepo.save(
      materialRepo.create({
        materialCode: 'M1',
        name: '测试物料',
        safetyStock: 10,
        unit: 'PCS',
        abcClass: 'UNSET',
        isSpecial: false,
        specialStatus: 'NORMAL',
      } as any),
    );
    await locationRepo.save([
      locationRepo.create({
        locationCode: 'WH01-A-01',
        warehouseCode: 'WH01',
        areaCode: 'A',
        name: 'A区01位',
      }),
      locationRepo.create({
        locationCode: 'WH01-B-01',
        warehouseCode: 'WH01',
        areaCode: 'B',
        name: 'B区01位',
      }),
    ]);
    const idem = new IdempotencyService(ds.getRepository(IdempotencyRecord));
    inv = new InventoryService(lotRepo, occRepo, movRepo, materialRepo, ds, idem);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('inbound → available 计算（含安全库存扣减，非 QUALIFIED 不计）', async () => {
    await inbound();
    let avail = await inv.available('M1');
    // 100 合格 - 0 占用 - 10 安全库存
    expect(avail.qualifiedQty).toBe(100);
    expect(avail.safetyStock).toBe(10);
    expect(avail.available).toBe(90);

    // 待检批次不计入可用量
    await inbound({
      packageNo: 'PKG-2',
      qty: 50,
      status: StockStatus.PENDING_INSPECTION,
      requestId: 'rid-in-2',
    });
    avail = await inv.available('M1');
    expect(avail.qualifiedQty).toBe(100);
    expect(avail.available).toBe(90);
  });

  it('occupy 后 available 减少；release 后回升', async () => {
    await inbound();
    await inv.occupy('WO1', [{ materialCode: 'M1', qty: 30 }], 'PREP-1', 'rid-occ-1');
    let avail = await inv.available('M1');
    expect(avail.occupiedQty).toBe(30);
    expect(avail.available).toBe(60);

    const released = await inv.releaseOccupation('PREP-1', 'rid-rel-1');
    expect(released).toBe(1);
    avail = await inv.available('M1');
    expect(avail.occupiedQty).toBe(0);
    expect(avail.available).toBe(90);
  });

  it('consumeOccupation：占用转 CONSUMED 并扣减实物批次库存', async () => {
    await inbound();
    await inv.occupy('WO1', [{ materialCode: 'M1', qty: 30 }], 'PREP-1', 'rid-occ-1');
    const consumed = await inv.consumeOccupation('PREP-1', 'rid-con-1');
    expect(consumed).toHaveLength(1);
    expect(consumed[0].status).toBe(OccupationStatus.CONSUMED);

    const lot = await lotRepo.findOne({ where: { packageNo: 'PKG-1' } });
    expect(lot.qty).toBe(70);
    const avail = await inv.available('M1');
    expect(avail.qualifiedQty).toBe(70);
    expect(avail.available).toBe(60); // 70 - 0 - 10

    const consumes = await movRepo.find({ where: { type: MovementType.CONSUME } });
    expect(consumes).toHaveLength(1);
    expect(consumes[0].qtyChange).toBe(-30);
  });

  it('同 requestId 重放不重复扣减/重复入库', async () => {
    await inbound();
    const again = await inbound(); // 同 requestId 重放
    expect(again.packageNo).toBe('PKG-1');
    const lots = await lotRepo.find();
    expect(lots).toHaveLength(1);

    await inv.occupy('WO1', [{ materialCode: 'M1', qty: 30 }], 'PREP-1', 'rid-occ-1');
    await inv.occupy('WO1', [{ materialCode: 'M1', qty: 30 }], 'PREP-1', 'rid-occ-1'); // 重放
    const occs = await occRepo.find();
    expect(occs).toHaveLength(1);
    let avail = await inv.available('M1');
    expect(avail.occupiedQty).toBe(30);

    await inv.consumeOccupation('PREP-1', 'rid-con-1');
    await inv.consumeOccupation('PREP-1', 'rid-con-1'); // 重放
    const lot = await lotRepo.findOne({ where: { packageNo: 'PKG-1' } });
    expect(lot.qty).toBe(70);
    avail = await inv.available('M1');
    expect(avail.available).toBe(60);
  });

  it('adjust 记流水且幂等；可用量不足时 occupy 拒绝', async () => {
    await inbound();
    await inv.adjust('PKG-1', 80, '盘点差异', 'STK-1', 'rid-adj-1');
    await inv.adjust('PKG-1', 80, '盘点差异', 'STK-1', 'rid-adj-1'); // 重放
    const lot = await lotRepo.findOne({ where: { packageNo: 'PKG-1' } });
    expect(lot.qty).toBe(80);
    const adjusts = await movRepo.find({ where: { type: MovementType.ADJUST } });
    expect(adjusts).toHaveLength(1);
    expect(adjusts[0].qtyChange).toBe(-20);

    await expect(
      inv.occupy('WO1', [{ materialCode: 'M1', qty: 999 }], 'PREP-2', 'rid-occ-2'),
    ).rejects.toThrow(/available/i);
  });

  it('changeStatus / moveLocation 记流水且影响可用量', async () => {
    await inbound();
    await inv.changeStatus('PKG-1', StockStatus.ISOLATED, 'IQC-1', 'rid-st-1');
    let avail = await inv.available('M1');
    expect(avail.available).toBe(-10); // 0 合格 - 0 占用 - 10 安全库存
    await inv.changeStatus('PKG-1', StockStatus.QUALIFIED, 'IQC-2', 'rid-st-2');
    await inv.moveLocation('PKG-1', 'WH01-B-01', 'TRF-1', 'rid-mv-1');
    const lot = await lotRepo.findOne({ where: { packageNo: 'PKG-1' } });
    expect(lot.locationCode).toBe('WH01-B-01');
    avail = await inv.available('M1');
    expect(avail.available).toBe(90);
  });
});
