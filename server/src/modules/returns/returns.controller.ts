import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { BizException } from '../../common/exceptions';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { ReturnsService } from './returns.service';
import { ReturnType } from './entities/return-order.entity';
import { ReplenishType } from './entities/replenish-order.entity';
import { WriteoffReason } from './entities/writeoff-order.entity';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

@Controller('returns')
export class ReturnsController {
  constructor(private readonly svc: ReturnsService) {}

  // ---------- 不良品处理记录 ----------

  @Post('defects')
  @Idempotent('returns.defectCreate')
  createDefect(
    @Body() body: {
      workOrderId: string;
      materialCode: string;
      qty: number;
      reason: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createDefect({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post('defects/:id/approve')
  approveDefect(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.approveDefect(id, user.username, user.roles);
  }

  @Post('defects/:id/reject')
  rejectDefect(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.rejectDefect(id, user.username, user.roles, body?.reason);
  }

  @Get('defects')
  defects() {
    return this.svc.defects();
  }

  // ---------- 损耗核销 ----------

  @Post('writeoffs')
  @Idempotent('returns.writeoffCreate')
  createWriteoff(
    @Body() body: {
      workOrderId?: string;
      materialCode: string;
      batchNo: string;
      packageNo: string;
      qty: number;
      reason: WriteoffReason;
      customerOrderNo?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createWriteoff({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post('writeoffs/:id/approve')
  approveWriteoff(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.approveWriteoff(id, user.username, user.roles);
  }

  @Post('writeoffs/:id/reject')
  rejectWriteoff(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.rejectWriteoff(id, user.username, user.roles, body?.reason);
  }

  @Post('writeoffs/:id/post')
  @Idempotent('returns.writeoffPost')
  postWriteoff(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.postWriteoff(id, reqId(rid, body), operator);
  }

  @Get('writeoffs/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportWriteoffs() {
    return this.svc.exportWriteoffs();
  }

  @Get('writeoffs')
  writeoffs() {
    return this.svc.writeoffs();
  }

  @Get('writeoffs/:id')
  writeoffDetail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.writeoffDetail(id);
  }

  // ---------- 补料 ----------

  @Post('replenish')
  @Idempotent('returns.replenish')
  createReplenish(
    @Body() body: {
      type: ReplenishType;
      workOrderId: string;
      materialCode: string;
      qty: number;
      relatedReturnDocNo?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createReplenish({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post('replenish/:id/approve')
  approveReplenish(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.approveReplenish(id, user.username, user.roles);
  }

  @Post('replenish/:id/post')
  @Idempotent('returns.replenishPost')
  postReplenish(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.postReplenish(id, reqId(rid, body), operator);
  }

  @Get('replenish')
  replenishes(@Query('isOver') isOver?: string) {
    return this.svc.replenishes(
      isOver === undefined ? undefined : { isOver: isOver === 'true' },
    );
  }

  @Get('replenish/:id')
  replenishDetail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.replenishDetail(id);
  }

  // ---------- 良/不良调拨 ----------

  @Post('qtransfers')
  @Idempotent('returns.qtransferCreate')
  createQTransfer(
    @Body() body: {
      packageNo: string;
      toStatus: string;
      toLocation?: string;
      reason: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createQTransfer({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post('qtransfers/:id/reverse')
  @Idempotent('returns.qtransferReverse')
  reverseQTransfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.reverseQTransfer(id, body?.reason, reqId(rid, body), operator);
  }

  @Post('qtransfers/:id/confirm')
  confirmQTransfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.confirmQTransfer(id, user.username, user.roles);
  }

  @Post('qtransfers/:id/approve')
  approveQTransfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.approveQTransfer(id, user.username, user.roles);
  }

  @Post('qtransfers/:id/post')
  @Idempotent('returns.qtransferPost')
  postQTransfer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.postQTransfer(id, reqId(rid, body), operator);
  }

  @Get('qtransfers')
  qtransfers() {
    return this.svc.qtransfers();
  }

  @Get('qtransfers/:id')
  qtDetail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.qtDetail(id);
  }

  // ---------- 退料 ----------

  @Post()
  @Idempotent('returns.create')
  createReturn(
    @Body() body: {
      type: ReturnType;
      workOrderId: string;
      materialCode: string;
      batchNo?: string;
      qty: number;
      toStatus?: string;
      defectDocNo?: string;
      reason?: string;
      locationCode?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createReturn({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post(':id/approve')
  approveReturn(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.approveReturn(id, user.username, user.roles);
  }

  @Post(':id/post')
  @Idempotent('returns.post')
  postReturn(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { locationCode?: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.postReturn(id, body?.locationCode, reqId(rid, body), operator);
  }

  @Get()
  returns(@Query('isOver') isOver?: string) {
    return this.svc.returns(isOver === undefined ? undefined : { isOver: isOver === 'true' });
  }

  @Get(':id')
  returnDetail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.returnDetail(id);
  }
}
