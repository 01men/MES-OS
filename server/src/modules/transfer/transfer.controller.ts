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
import { CurrentUser, CurrentUserPayload } from '../auth/current-user.decorator';
import { TransferService } from './transfer.service';
import { TransferStatus } from './entities/transfer-order.entity';
import { ReplenishTodoStatus } from './entities/replenish-todo.entity';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

@Controller('transfer')
export class TransferController {
  constructor(private readonly svc: TransferService) {}

  /** 创建挪料单：源工单→目标工单；专用件（含未确认）自动发起班组长审批 */
  @Post()
  @Idempotent('transfer.create')
  create(
    @Body() body: {
      sourceWorkOrderId: string;
      targetWorkOrderId: string;
      materialCode: string;
      batchNo?: string;
      qty: number;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.create({ ...body, requestId: reqId(rid, body), operator });
  }

  /** 班组长审批通过 */
  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.approve(id, user.username, user.roles);
  }

  /** 审批驳回 */
  @Post(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.reject(id, user.username, user.roles, body?.reason);
  }

  /** 过账：释放源占用 + 建立目标占用（专用件须审批已通过） */
  @Post(':id/post')
  @Idempotent('transfer.post')
  post(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.post(id, reqId(rid, body), operator);
  }

  /** 到货补回提醒：入参物料编码，扫描曾被挪出的工单生成补料待办 */
  @Post('replenish-check')
  replenishCheck(
    @Body() body: { materialCode: string },
    @CurrentUser('username') operator: string,
  ) {
    if (!body?.materialCode) throw new BizException('MATERIAL_REQUIRED', 'materialCode is required');
    return this.svc.replenishCheck(body.materialCode, operator);
  }

  /** PMC 确认补回：创建反向挪料单并关闭待办（原挪料记录保留） */
  @Post('replenish/:todoId/confirm')
  @Idempotent('transfer.confirmReplenish')
  confirmReplenish(
    @Param('todoId', ParseIntPipe) todoId: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.confirmReplenish(todoId, reqId(rid, body), operator);
  }

  /** 补料待办列表 */
  @Get('todos')
  todos(@Query('status') status?: ReplenishTodoStatus) {
    return this.svc.todos(status);
  }

  /** 挪料路径追溯（按批次） */
  @Get('trace/:lotId')
  trace(@Param('lotId') lotId: string) {
    return this.svc.trace(lotId);
  }

  /** 专用件批次查询（带所属工单维度） */
  @Get('batches')
  batches(@Query('materialCode') materialCode: string) {
    if (!materialCode) throw new BizException('MATERIAL_REQUIRED', 'materialCode is required');
    return this.svc.batches(materialCode);
  }

  /** 返工申请（发起审批） */
  @Post('rework')
  @Idempotent('transfer.reworkApply')
  applyRework(
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
    return this.svc.applyRework({ ...body, requestId: reqId(rid, body), operator });
  }

  /** 返工审批通过（班组长） */
  @Post('rework/:id/approve')
  approveRework(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.approveRework(id, user.username, user.roles);
  }

  /** 返工发料：无已批准返工单即拒 */
  @Post('rework/:id/issue')
  @Idempotent('transfer.reworkIssue')
  issueRework(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { prepDocNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    if (!body?.prepDocNo) throw new BizException('PREP_DOC_REQUIRED', 'prepDocNo is required');
    return this.svc.issueRework(id, body.prepDocNo, reqId(rid, body), operator);
  }

  @Get('rework/:id')
  reworkDetail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reworkDetail(id);
  }

  @Get()
  list(@Query('status') status?: TransferStatus) {
    return this.svc.list(status);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }
}
