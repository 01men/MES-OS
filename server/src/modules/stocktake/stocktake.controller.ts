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
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { StocktakeService, ActorContext } from './stocktake.service';
import { StocktakeStrategy } from './entities/stocktake-strategy.entity';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

function actorOf(user: CurrentUserPayload): ActorContext {
  return { username: user.username, roles: user.roles ?? [] };
}

/**
 * 盘点链 REST（/api/stocktake/*，供前端 P10/P11）。
 * 盲盘字段过滤与第二人复盘/过账仍由服务层按角色/操作人强校验。
 */
@Controller('stocktake')
export class StocktakeController {
  constructor(
    private readonly svc: StocktakeService,
    private readonly approval: ApprovalEngineService,
  ) {}

  // ---------- 策略 CRUD ----------

  @Get('strategies')
  listStrategies() {
    return this.svc.listStrategies();
  }

  @Post('strategies')
  createStrategy(
    @Body() body: Partial<StocktakeStrategy> & { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.createStrategy(body, user.username, reqId(rid, body));
  }

  // ---------- 任务生成 / 查询 ----------

  @Post('tasks/generate')
  generate(
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.generateTasks(user.username, reqId(rid, body));
  }

  @Get('tasks')
  listTasks(@Query('status') status?: string) {
    return this.svc.listTasks(status);
  }

  @Get('tasks/:id')
  getTask(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.getTask(id, actorOf(user));
  }

  // ---------- 盘点提交 / 复盘 ----------

  @Post('tasks/:id/count')
  count(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lineNo: string; actualQty: number; reason?: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.count(id, body, actorOf(user), reqId(rid, body));
  }

  @Post('tasks/:id/recount')
  recount(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lineNo: string; actualQty: number; reason?: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.recount(id, body, actorOf(user), reqId(rid, body));
  }

  // ---------- 库龄分析 ----------

  @Get('aging')
  aging() {
    return this.svc.aging();
  }

  // ---------- 审批（软冻结 / 差异调整共用入口） ----------

  @Post('approvals/:approvalId/approve')
  async approve(
    @Param('approvalId', ParseIntPipe) approvalId: number,
    @Body() body: { comment?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.approval.approve(approvalId, user.username, user.roles ?? [], body?.comment);
    return this.svc.onApprovalActed(approvalId);
  }

  @Post('approvals/:approvalId/reject')
  async reject(
    @Param('approvalId', ParseIntPipe) approvalId: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.approval.reject(approvalId, user.username, user.roles ?? [], body?.reason);
  }

  // ---------- 冻结 / 解冻 ----------

  @Post(':id/freeze')
  freeze(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mode: 'HARD' | 'SOFT'; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.freeze(id, body?.mode, actorOf(user), reqId(rid, body));
  }

  @Post(':id/unfreeze')
  unfreeze(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.unfreeze(id, actorOf(user), reqId(rid, body));
  }

  @Post(':id/frozen-movements')
  recordFrozenMovement(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { packageNo: string; movementType: string; qtyChange: number; docNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.recordFrozenMovement(id, body, actorOf(user), reqId(rid, body));
  }

  // ---------- 差异过账 / 报告 ----------

  @Post(':id/post-adjustments')
  postAdjustments(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.postAdjustments(id, actorOf(user), reqId(rid, body));
  }

  @Get(':id/report')
  report(@Param('id', ParseIntPipe) id: number) {
    return this.svc.report(id);
  }
}
