import { Body, Controller, Get, Param, Post, Query, Headers } from '@nestjs/common';
import { InventoryService, InboundInput, OccupyItem } from './inventory.service';
import { StockStatus } from '../../common/enums';
import { BizException } from '../../common/exceptions';
import { RequirePerm } from '../rbac/require-perm.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Post('inbound')
  @RequirePerm('inventory.inbound')
  inbound(
    @Body() body: Omit<InboundInput, 'requestId' | 'operator'> & { requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.inbound({ ...body, requestId: reqId(rid, body), operator });
  }

  @Post('status')
  @RequirePerm('inventory.move')
  changeStatus(
    @Body() body: { packageNo: string; toStatus: StockStatus; docNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.changeStatus(body.packageNo, body.toStatus, body.docNo, reqId(rid, body), operator);
  }

  @Post('move')
  @RequirePerm('inventory.move')
  move(
    @Body() body: { packageNo: string; toLocation: string; docNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.moveLocation(body.packageNo, body.toLocation, body.docNo, reqId(rid, body), operator);
  }

  @Post('occupy')
  @RequirePerm('inventory.move')
  occupy(
    @Body() body: { workOrderId: string; items: OccupyItem[]; prepDocNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.occupy(body.workOrderId, body.items, body.prepDocNo, reqId(rid, body), operator);
  }

  @Post('release')
  @RequirePerm('inventory.move')
  release(
    @Body() body: { prepDocNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.releaseOccupation(body.prepDocNo, reqId(rid, body), operator);
  }

  @Post('consume')
  @RequirePerm('inventory.move')
  consume(
    @Body() body: { prepDocNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.consumeOccupation(body.prepDocNo, reqId(rid, body), operator);
  }

  @Post('adjust')
  @RequirePerm('inventory.adjust')
  adjust(
    @Body() body: { packageNo: string; newQty: number; reason: string; docNo: string; requestId?: string },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.inv.adjust(body.packageNo, body.newQty, body.reason, body.docNo, reqId(rid, body), operator);
  }

  @Get('available/:materialCode')
  @RequirePerm('inventory.read')
  available(@Param('materialCode') materialCode: string, @Query('warehouseCode') warehouseCode?: string) {
    return this.inv.available(materialCode, warehouseCode);
  }

  @Get('lots')
  @RequirePerm('inventory.read')
  lots(@Query() filter: any) {
    return this.inv.queryLots(filter);
  }
}
