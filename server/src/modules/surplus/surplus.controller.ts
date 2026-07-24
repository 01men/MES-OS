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
import { SurplusService } from './surplus.service';
import { SurplusSourceType, SurplusStatus } from './entities/surplus-record.entity';
import { SurplusProcessMethod } from './entities/surplus-process.entity';
import { ReminderStatus } from './entities/surplus-reminder.entity';

function reqId(header: string | undefined, body?: any): string {
  const id = header || body?.requestId;
  if (!id) throw new BizException('REQUEST_ID_REQUIRED', 'X-Request-Id header is required');
  return id;
}

@Controller('surplus')
export class SurplusController {
  constructor(private readonly svc: SurplusService) {}

  /** 余料登记（人工登记+标记）：整包入 YL 余料区 */
  @Post()
  @Idempotent('surplus.register')
  register(
    @Body() body: {
      packageNo: string;
      sourceType: SurplusSourceType;
      sourceDocNo: string;
      responsible: string;
      workOrderId?: string;
      occurredAt?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.register({ ...body, requestId: reqId(rid, body), operator });
  }

  /** prep leftoverReminder 场景：从发料剩余直接登记入 YL */
  @Post('from-leftover')
  @Idempotent('surplus.fromLeftover')
  fromLeftover(
    @Body() body: {
      packageNo: string;
      prepDocNo: string;
      responsible: string;
      workOrderId?: string;
      occurredAt?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.registerFromLeftover({ ...body, requestId: reqId(rid, body), operator });
  }

  /** 扫描生成到期提醒（RuleConfig surplus.remindDays） */
  @Post('reminders/scan')
  scanReminders() {
    return this.svc.scanReminders();
  }

  /** 提醒待办列表 */
  @Get('reminders')
  reminders(@Query('status') status?: ReminderStatus) {
    return this.svc.reminders(status);
  }

  @Get()
  list(@Query('status') status?: SurplusStatus) {
    return this.svc.list(status);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.svc.detail(id);
  }

  /** 处理余料：RETURN_SUPPLIER / REUSE_ORDER / CROSS_TRANSFER */
  @Post(':id/process')
  @Idempotent('surplus.process')
  process(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      method: SurplusProcessMethod;
      qty: number;
      targetWorkOrderId?: string;
      requestId?: string;
    },
    @Headers('x-request-id') rid: string,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.process(id, { ...body, requestId: reqId(rid, body), operator });
  }

  /** 标签打印/补打（留痕），返回渲染好的标签字段 JSON */
  @Post(':id/print')
  print(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('username') operator: string,
  ) {
    return this.svc.print(id, operator);
  }
}
