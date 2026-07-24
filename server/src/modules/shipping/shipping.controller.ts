import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ShippingService, CreateNoteInput, PhotoConfirmItem } from './shipping.service';
import { TraceService } from './trace.service';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { DocStatus } from '../../common/enums';

/**
 * 发运追溯链 API（/api/shipping/*，前端 P13/P14/P17）。
 * 写接口幂等：X-Request-Id + @Idempotent 去重，服务层另有业务键幂等（dnNo/serialNo/fileName 唯一）。
 */
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly svc: ShippingService,
    private readonly trace: TraceService,
  ) {}

  // ---------- REQ-022 发货通知 ----------

  @Post('pull-notes')
  @Idempotent('shipping.pullNotes')
  pullNotes(@Body() body: { since?: string }, @CurrentUser('username') operator: string) {
    return this.svc.pullNotes(body?.since, operator);
  }

  /** 销售在系统内创建发货请求（含装柜顺序 loadingSequence） */
  @Post('notes')
  @Idempotent('shipping.createNote')
  createNote(@Body() body: CreateNoteInput, @CurrentUser('username') operator: string) {
    return this.svc.createNote(body, operator);
  }

  @Get('notes')
  listNotes(@Query('status') status?: DocStatus) {
    return this.svc.listNotes(status);
  }

  @Get('notes/:id')
  getNote(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getNote(id);
  }

  // ---------- 出库扫码 / 拍照 / 放行 / 少发 / 冲销 ----------

  @Post('notes/:id/scan')
  @Idempotent('shipping.scan')
  scan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { serialNo: string },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.scan(id, body?.serialNo, operator);
  }

  @Post('notes/:id/photos/confirm')
  @Idempotent('shipping.confirmPhotos')
  confirmPhotos(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { photos: PhotoConfirmItem[] },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.confirmPhotos(id, body?.photos, operator);
  }

  @Post('notes/:id/release')
  @Idempotent('shipping.release')
  release(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { keeperConfirm?: boolean; driverName?: string; driverConfirm?: boolean },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.release(id, body ?? {}, operator);
  }

  @Post('notes/:id/short-ship')
  @Idempotent('shipping.shortShip')
  shortShip(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.shortShip(id, body ?? {}, operator);
  }

  @Post('notes/:id/reversal')
  @Idempotent('shipping.reversal')
  reversal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.reversal(id, body ?? {}, operator);
  }

  /** 少发审批（approve=false 即驳回，单据置回草稿） */
  @Post('approvals/:id/approve')
  @Idempotent('shipping.approveShortShip')
  approveShortShip(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approve?: boolean; comment?: string },
    @CurrentUser('username') operator: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.svc.approveShortShip(id, body?.approve !== false, operator, roles ?? [], body?.comment);
  }

  // ---------- REQ-026 双向追溯 ----------

  @Get('trace/forward')
  traceForward(@Query('batchNo') batchNo: string) {
    return this.trace.forward(batchNo);
  }

  @Get('trace/backward')
  traceBackward(@Query('serialNo') serialNo: string) {
    return this.trace.backward(serialNo);
  }

  @Get('trace/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  traceExport(@Query() query: { batchNo?: string; serialNo?: string }) {
    return this.trace.exportCsv(query);
  }

  // ---------- 成品序列号主数据 ----------

  @Post('serials')
  @Idempotent('shipping.registerSerials')
  registerSerials(
    @Body() body: { serials: { serialNo: string; productCode: string; batchNo?: string; workOrderId?: string }[] },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.registerSerials(body?.serials, operator);
  }

  @Get('serials')
  listSerials(@Query() filter: { status?: string; productCode?: string; workOrderId?: string }) {
    return this.svc.listSerials(filter ?? {});
  }
}
