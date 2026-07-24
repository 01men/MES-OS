import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { BizException } from '../../common/exceptions';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { KittingService } from './kitting.service';
import { PrepService } from './prep.service';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

/**
 * 生产发料链 REST（/api/prep/*，供前端 P03/P04/P05）。
 */
@Controller('prep')
export class PrepController {
  constructor(
    private readonly prep: PrepService,
    private readonly kitting: KittingService,
  ) {}

  // ---- REQ-005 齐套 ----

  @Get('kitting')
  kittingCheck(@Query('workOrderId') workOrderId: string) {
    if (!workOrderId) throw new BizException('WORK_ORDER_REQUIRED', 'workOrderId query is required');
    return this.kitting.compute(workOrderId);
  }

  @Get('kitting/board')
  kittingBoard() {
    return this.kitting.board();
  }

  // ---- REQ-006+008 备料任务 ----

  @Post('tasks')
  @Idempotent('prep.task.create')
  createTask(
    @Body() body: { workOrderId: string; emergencyReason?: string },
    @CurrentUser('username') operator: string,
  ) {
    if (!body?.workOrderId) throw new BizException('WORK_ORDER_REQUIRED', 'workOrderId is required');
    return this.prep.createTask(body.workOrderId, body.emergencyReason, operator);
  }

  @Get('tasks/:id')
  getTask(@Param('id', ParseIntPipe) id: number) {
    return this.prep.getTask(id);
  }

  @Post('tasks/:id/scan')
  @Idempotent('prep.task.scan')
  scan(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { packageNo: string; qty?: number; device?: string },
    @Headers('x-device') device: string,
    @CurrentUser('username') operator: string,
  ) {
    if (!body?.packageNo) throw new BizException('PACKAGE_NO_REQUIRED', 'packageNo is required');
    return this.prep.scan(id, { ...body, device: body.device ?? device }, operator);
  }

  @Post('tasks/:id/suspend')
  @Idempotent('prep.task.suspend')
  suspend(@Param('id', ParseIntPipe) id: number, @CurrentUser('username') operator: string) {
    return this.prep.suspend(id, operator);
  }

  @Post('tasks/:id/complete')
  @Idempotent('prep.task.complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.prep.complete(id, operator, reqId(rid));
  }

  // ---- REQ-007 物权交接 / 退回 / 更正 ----

  @Post(':prepId/handover/confirm')
  @Idempotent('prep.handover.confirm')
  confirmHandover(
    @Param('prepId') prepId: string,
    @Body() body: { role: 'KEEPER' | 'RECEIVER'; device?: string },
    @Headers('x-request-id') rid: string,
    @Headers('x-device') device: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.prep.confirmHandover(
      prepId,
      { role: body?.role, device: body?.device ?? device },
      operator,
      reqId(rid, body),
    );
  }

  @Post(':prepId/handover/reject')
  @Idempotent('prep.handover.reject')
  rejectHandover(
    @Param('prepId') prepId: string,
    @Body() body: { reason?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.prep.rejectHandover(prepId, body?.reason, operator, reqId(rid, body));
  }

  @Post(':prepId/reversal')
  @Idempotent('prep.reversal')
  reversal(
    @Param('prepId') prepId: string,
    @Body() body: { reason: string },
    @CurrentUser('username') operator: string,
  ) {
    return this.prep.reversal(prepId, body?.reason, operator);
  }

  // ---- REQ-008 AGV 预留 ----

  @Get(':prepId/agv-task')
  agvTask(@Param('prepId') prepId: string) {
    return this.prep.agvTask(prepId);
  }

  // ---- 备料单 ----

  @Get('orders')
  listOrders() {
    return this.prep.listOrders();
  }

  @Get('orders/:prepDocNo')
  getOrder(@Param('prepDocNo') prepDocNo: string) {
    return this.prep.getOrder(prepDocNo);
  }
}
