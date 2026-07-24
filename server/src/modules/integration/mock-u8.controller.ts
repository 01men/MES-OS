import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import {
  MOCK_DELIVERY_NOTES,
  MOCK_PURCHASE_ORDERS,
  mockMasterData,
  sinceFilter,
} from './mock-u8-data';

/**
 * Mock U8 供给侧接口：挂在 /mock-u8，不走 /api 全局前缀（见 main.ts exclude）。
 * 模拟用友 U8 的采购订单 / 发货通知 / 主数据增量拉取。
 */
@Public()
@Controller('mock-u8')
export class MockU8Controller {
  @Get('purchase-orders')
  purchaseOrders(@Query('since') since?: string) {
    return { data: sinceFilter(MOCK_PURCHASE_ORDERS, since) };
  }

  @Get('delivery-notes')
  deliveryNotes(@Query('since') since?: string) {
    return { data: sinceFilter(MOCK_DELIVERY_NOTES, since) };
  }

  @Get('master-data/:type')
  masterData(@Param('type') type: string) {
    return { data: mockMasterData(type) };
  }
}
