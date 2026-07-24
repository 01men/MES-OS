import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../common/audit/audit.entity';
import { AuditQueryController } from './auditquery.controller';

/** 审计查询 REST（只读；AuditLog 实体复用 common/audit，不新建表） */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditQueryController],
})
export class AuditqueryModule {}
