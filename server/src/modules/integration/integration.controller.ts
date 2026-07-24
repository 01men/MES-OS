import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { SyncService, EnqueueInput } from './sync.service';
import { U8Adapter } from './u8-adapter';
import { RequirePerm } from '../rbac/require-perm.decorator';

@Controller('integration')
export class IntegrationController {
  constructor(
    private readonly sync: SyncService,
    private readonly adapter: U8Adapter,
  ) {}

  /** 单据置 PENDING_SYNC 后入队（骨架入口；业务模块也可直接注入 SyncService） */
  @Post('sync')
  @RequirePerm('integration.replay')
  enqueue(@Body() body: EnqueueInput) {
    return this.sync.enqueue(body);
  }

  /** 人工重放（幂等） */
  @Post('replay/:id')
  @RequirePerm('integration.replay')
  replay(@Param('id', ParseIntPipe) id: number) {
    return this.sync.replay(id);
  }

  @Get('logs')
  @RequirePerm('integration.read')
  logs() {
    return this.sync.logs();
  }

  /** 日终对账：MES 已同步 vs U8Voucher 差异清单 */
  @Post('reconcile')
  @RequirePerm('integration.reconcile')
  reconcile() {
    return this.sync.reconcile();
  }

  /** U8 供给侧拉取（适配器直通） */
  @Get('u8/purchase-orders')
  @RequirePerm('integration.read')
  purchaseOrders(@Query('since') since?: string) {
    return this.adapter.fetchPurchaseOrders(since);
  }

  @Get('u8/delivery-notes')
  @RequirePerm('integration.read')
  deliveryNotes(@Query('since') since?: string) {
    return this.adapter.fetchDeliveryNotes(since);
  }
}
