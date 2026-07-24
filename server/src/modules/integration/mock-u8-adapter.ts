import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { U8Adapter } from './u8-adapter';
import { U8Voucher } from './u8-voucher.entity';
import { BizException } from '../../common/exceptions';
import { RuleConfigService } from '../config/rule-config.service';
import {
  MOCK_DELIVERY_NOTES,
  MOCK_PURCHASE_ORDERS,
  mockMasterData,
  sinceFilter,
} from './mock-u8-data';

/**
 * Mock U8 适配器：落库 U8Voucher 表模拟 U8 接收。
 * 故障开关：RuleConfig u8.mockFailure === 'true' 时 pushVoucher 抛错（测试异常链路用）。
 */
@Injectable()
export class MockU8Adapter extends U8Adapter {
  constructor(
    @InjectRepository(U8Voucher)
    private readonly voucherRepo: Repository<U8Voucher>,
    private readonly ruleConfig: RuleConfigService,
  ) {
    super();
  }

  async pushVoucher(voucherType: string, payload: unknown, bizKey: string) {
    const fail = await this.ruleConfig.get('u8.mockFailure');
    if (fail === 'true') {
      throw new BizException('U8_UNAVAILABLE', 'Mock U8 failure switch is ON (u8.mockFailure=true)');
    }
    // bizKey 唯一约束 → 重复推送返回已存在凭证，不产生重复 U8 单据
    const existing = await this.voucherRepo.findOne({ where: { bizKey } });
    if (existing) return { u8Id: `U8-${existing.id}` };
    const saved = await this.voucherRepo.save(
      this.voucherRepo.create({ voucherType, bizKey, payload: JSON.stringify(payload ?? {}) }),
    );
    return { u8Id: `U8-${saved.id}` };
  }

  async fetchPurchaseOrders(since?: string) {
    return sinceFilter(MOCK_PURCHASE_ORDERS, since);
  }

  async fetchDeliveryNotes(since?: string) {
    return sinceFilter(MOCK_DELIVERY_NOTES, since);
  }

  async fetchMasterData(type: string) {
    return mockMasterData(type);
  }

  async reportStock() {
    return { reported: true };
  }
}
