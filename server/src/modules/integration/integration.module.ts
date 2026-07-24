import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { U8Adapter } from './u8-adapter';
import { MockU8Adapter } from './mock-u8-adapter';
import { U8Voucher } from './u8-voucher.entity';
import { SyncTask } from './sync-task.entity';
import { SyncService } from './sync.service';
import { IntegrationController } from './integration.controller';
import { MockU8Controller } from './mock-u8.controller';

export const INTEGRATION_ENTITIES = [U8Voucher, SyncTask];

@Module({
  imports: [TypeOrmModule.forFeature(INTEGRATION_ENTITIES)],
  controllers: [IntegrationController, MockU8Controller],
  providers: [
    // DI 替换点：生产环境把 MockU8Adapter 换成真实 U8 HTTP 适配器
    { provide: U8Adapter, useClass: MockU8Adapter },
    SyncService,
  ],
  exports: [SyncService, U8Adapter],
})
export class IntegrationModule {}
