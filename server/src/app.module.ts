import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildTypeOrmOptions, discoverModules } from './database';
import { NumberingModule } from './common/numbering/numbering.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { AuditModule } from './common/audit/audit.module';
import { ApprovalModule } from './common/approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions(false)),
    // 全局公共服务
    NumberingModule,
    IdempotencyModule,
    AuditModule,
    ApprovalModule,
    // 业务模块：约定优于配置，自动发现 src/modules/*/*.module.ts
    ...discoverModules(),
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
