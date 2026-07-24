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
import { ReceivingService, ConfirmInput, CreateArrivalInput, IqcInput } from './receiving.service';
import { ArrivalStatus } from './entities/receiving-arrival.entity';
import { BizException } from '../../common/exceptions';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { RequirePerm } from '../rbac/require-perm.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

/** 来料链接收：扫码 → 到货暂存 → 送检 → IQC → 确认入库/隔离 */
@Controller('receiving')
export class ReceivingController {
  constructor(private readonly svc: ReceivingService) {}

  /** 解析最小包装条码 → 采购订单 + 物料 + ABC 清点策略提示 */
  @Post('scan')
  @RequirePerm('inventory.read')
  scan(@Body() body: { barcode?: string }) {
    return this.svc.scan(body);
  }

  /** 从 Mock U8 同步采购订单（重复拉取幂等） */
  @Post('orders/sync')
  @RequirePerm('inventory.inbound')
  syncOrders(
    @Body() body: { since?: string },
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.syncPurchaseOrders(body?.since, operator);
  }

  /** 已同步的采购订单列表（含行） */
  @Get('orders')
  @RequirePerm('inventory.read')
  orders() {
    return this.svc.listOrders();
  }

  /** 创建到货暂存单（三步链第一步），生成包装号/批次号/首打标签 */
  @Post('arrivals')
  @RequirePerm('inventory.inbound')
  @Idempotent('receiving.arrival')
  createArrival(
    @Body() body: CreateArrivalInput & { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.createArrival(body, reqId(rid, body), operator);
  }

  @Get('arrivals')
  @RequirePerm('inventory.read')
  arrivals(@Query('status') status?: ArrivalStatus) {
    return this.svc.listArrivals(status);
  }

  @Get(':id')
  @RequirePerm('inventory.read')
  arrival(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getArrival(id);
  }

  /** 送检（三步链第二步） */
  @Post(':id/send-inspect')
  @RequirePerm('inventory.move')
  @Idempotent('receiving.sendInspect')
  sendInspect(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.sendInspect(id, reqId(rid, body), operator);
  }

  /** IQC 判定提交（全部/部分/特采 + 数量明细） */
  @Post(':id/iqc')
  @RequirePerm('inventory.move')
  @Idempotent('receiving.iqc')
  iqc(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: IqcInput & { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.submitIqc(id, body, reqId(rid, body), operator);
  }

  /** 确认入库/隔离：生成批次+包装号+入库存+入队同步 U8 */
  @Post(':id/confirm')
  @RequirePerm('inventory.inbound')
  @Idempotent('receiving.confirm')
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ConfirmInput & { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.confirm(id, body ?? {}, reqId(rid, body), operator);
  }

  /** 标签补打（原因必填，记 LabelPrintLog） */
  @Post('labels/reprint')
  @RequirePerm('inventory.inbound')
  @Idempotent('receiving.label.reprint')
  reprint(
    @Body() body: { packageNo: string; reason?: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.reprintLabel(body?.packageNo, body?.reason, reqId(rid, body), operator);
  }
}
