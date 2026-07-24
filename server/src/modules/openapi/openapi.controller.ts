import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { BizException } from '../../common/exceptions';
import { StockStatus } from '../../common/enums';
import { Material } from '../masterdata/entities/material.entity';
import { PoOrderType, RcvPurchaseOrder, RcvPurchaseOrderLine } from '../receiving/entities/purchase-order.entity';
import { ReceivingArrival } from '../receiving/entities/receiving-arrival.entity';
import { DeliveryNote } from '../shipping/entities/delivery-note.entity';
import { DeliveryNoteLine } from '../shipping/entities/delivery-note-line.entity';
import { InventoryService } from '../inventory/inventory.service';
import { SyncService } from '../integration/sync.service';
import { OpenApiKeyGuard } from './open-api-key.guard';

function positive(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BizException('VALIDATION_ERROR', `${field} must be greater than 0`);
  }
  return parsed;
}

function pageArgs(pageValue: unknown, sizeValue: unknown) {
  const page = Math.max(1, Number(pageValue) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sizeValue) || 50));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

@Public()
@UseGuards(OpenApiKeyGuard)
@Controller('open/v1')
export class OpenApiController {
  constructor(
    @InjectRepository(Material) private readonly materials: Repository<Material>,
    @InjectRepository(RcvPurchaseOrder) private readonly pos: Repository<RcvPurchaseOrder>,
    @InjectRepository(RcvPurchaseOrderLine) private readonly poLines: Repository<RcvPurchaseOrderLine>,
    @InjectRepository(ReceivingArrival) private readonly arrivals: Repository<ReceivingArrival>,
    @InjectRepository(DeliveryNote) private readonly deliveries: Repository<DeliveryNote>,
    @InjectRepository(DeliveryNoteLine) private readonly deliveryLines: Repository<DeliveryNoteLine>,
    private readonly inventory: InventoryService,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
  ) {}

  @Get('health')
  health(@Req() req: any) {
    return {
      service: 'MES Open API',
      version: 'v1',
      status: 'ok',
      client: req.integrationClient,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('materials')
  async listMaterials(@Query('page') pageValue?: string, @Query('pageSize') sizeValue?: string) {
    const { page, pageSize, skip } = pageArgs(pageValue, sizeValue);
    const [items, total] = await this.materials.findAndCount({
      order: { materialCode: 'ASC' },
      skip,
      take: pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Put('materials/:materialCode')
  async upsertMaterial(
    @Param('materialCode') materialCode: string,
    @Body() body: Partial<Material>,
    @Req() req: any,
  ) {
    if (!body?.name) throw new BizException('VALIDATION_ERROR', 'name is required');
    const before = await this.materials.findOne({ where: { materialCode } });
    const saved = await this.materials.save(this.materials.create({
      ...before,
      ...body,
      materialCode,
      safetyStock: Number(body.safetyStock ?? before?.safetyStock ?? 0),
    }));
    await this.record(req, 'openapi.material.upsert', materialCode, before, saved);
    return saved;
  }

  @Get('inventory/lots')
  async listLots(
    @Query('materialCode') materialCode?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('status') status?: StockStatus,
    @Query('page') pageValue?: string,
    @Query('pageSize') sizeValue?: string,
  ) {
    const { page, pageSize, skip } = pageArgs(pageValue, sizeValue);
    const all = await this.inventory.queryLots({ materialCode, warehouseCode, status });
    return { items: all.slice(skip, skip + pageSize), page, pageSize, total: all.length };
  }

  @Get('inventory/available/:materialCode')
  available(
    @Param('materialCode') materialCode: string,
    @Query('warehouseCode') warehouseCode?: string,
  ) {
    return this.inventory.available(materialCode, warehouseCode);
  }

  @Post('inventory/inbound')
  async inbound(
    @Body() body: any,
    @Headers('x-request-id') headerRequestId: string | undefined,
    @Req() req: any,
  ) {
    const requestId = headerRequestId || body.requestId;
    if (!requestId) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-ID or requestId is required');
    const saved = await this.inventory.inbound({
      packageNo: String(body.packageNo ?? ''),
      materialCode: String(body.materialCode ?? ''),
      batchNo: String(body.batchNo ?? ''),
      qty: positive(body.qty, 'qty'),
      warehouseCode: String(body.warehouseCode ?? ''),
      locationCode: String(body.locationCode ?? ''),
      status: body.status,
      workOrderId: body.workOrderId,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
      sourceDocNo: String(body.sourceDocNo ?? ''),
      requestId,
      operator: `integration:${req.integrationClient}`,
    });
    await this.record(req, 'openapi.inventory.inbound', saved.packageNo, undefined, saved);
    return saved;
  }

  @Post('purchase-orders/import')
  async importPurchaseOrder(@Body() body: any, @Req() req: any) {
    if (!body?.poNo || !body?.supplierCode || !Array.isArray(body.lines) || !body.lines.length) {
      throw new BizException('VALIDATION_ERROR', 'poNo, supplierCode and non-empty lines are required');
    }
    const before = await this.pos.findOne({ where: { poNo: body.poNo } });
    const header = await this.pos.save(this.pos.create({
      ...before,
      poNo: String(body.poNo),
      supplierCode: String(body.supplierCode),
      orderType: body.orderType ?? PoOrderType.NORMAL,
      status: body.status ?? 'OPEN',
      sourceUpdatedAt: body.sourceUpdatedAt ?? new Date().toISOString(),
    }));
    await this.poLines.delete({ poNo: header.poNo });
    const lines = await this.poLines.save(body.lines.map((line: any) => this.poLines.create({
      poNo: header.poNo,
      materialCode: String(line.materialCode ?? ''),
      qty: positive(line.qty, 'lines[].qty'),
      receivedQty: Number(line.receivedQty ?? 0),
      unit: line.unit ?? 'PCS',
    })));
    await this.record(req, 'openapi.purchase-order.import', header.poNo, before, { ...header, lines });
    return { ...header, lines };
  }

  @Get('receiving/arrivals')
  async listArrivals(@Query('page') pageValue?: string, @Query('pageSize') sizeValue?: string) {
    const { page, pageSize, skip } = pageArgs(pageValue, sizeValue);
    const [items, total] = await this.arrivals.findAndCount({
      order: { id: 'DESC' },
      skip,
      take: pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('delivery-notes/import')
  async importDeliveryNote(@Body() body: any, @Req() req: any) {
    if (!body?.dnNo || !body?.customerCode || !Array.isArray(body.lines) || !body.lines.length) {
      throw new BizException('VALIDATION_ERROR', 'dnNo, customerCode and non-empty lines are required');
    }
    const before = await this.deliveries.findOne({ where: { dnNo: body.dnNo } });
    const note = await this.deliveries.save(this.deliveries.create({
      ...before,
      dnNo: String(body.dnNo),
      customerCode: String(body.customerCode),
      customerName: body.customerName ?? null,
      source: body.source ?? 'U8',
      status: body.status ?? before?.status,
      u8UpdatedAt: body.u8UpdatedAt ?? new Date().toISOString(),
    }));
    await this.deliveryLines.delete({ noteId: note.id });
    const lines = await this.deliveryLines.save(body.lines.map((line: any, index: number) =>
      this.deliveryLines.create({
        noteId: note.id,
        orderNo: String(line.orderNo ?? body.dnNo),
        productCode: String(line.productCode ?? ''),
        qty: positive(line.qty, 'lines[].qty'),
        unit: line.unit ?? 'PCS',
        sortOrder: Number(line.sortOrder ?? index),
      }),
    ));
    await this.record(req, 'openapi.delivery-note.import', note.dnNo, before, { ...note, lines });
    return { ...note, lines };
  }

  @Post('sync/tasks')
  async enqueueSync(@Body() body: any, @Req() req: any) {
    if (!body?.bizType || !body?.bizKey || !body?.voucherType) {
      throw new BizException('VALIDATION_ERROR', 'bizType, bizKey and voucherType are required');
    }
    const task = await this.sync.enqueue({
      bizType: body.bizType,
      bizKey: body.bizKey,
      voucherType: body.voucherType,
      payload: body.payload ?? {},
    });
    await this.record(req, 'openapi.sync.enqueue', body.bizKey, undefined, task);
    return task;
  }

  @Get('sync/tasks')
  async listSyncTasks(@Query('page') pageValue?: string, @Query('pageSize') sizeValue?: string) {
    const { page, pageSize, skip } = pageArgs(pageValue, sizeValue);
    const all = await this.sync.logs();
    return { items: all.slice(skip, skip + pageSize), page, pageSize, total: all.length };
  }

  private record(req: any, action: string, docNo: string, before: unknown, after: unknown) {
    return this.audit.log({
      operator: `integration:${req.integrationClient}`,
      role: 'OPEN_API_CLIENT',
      ip: req.ip,
      action,
      docNo,
      before,
      after,
      result: 'SUCCESS',
    });
  }
}
