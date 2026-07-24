import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Approval } from './approval.entity';
import { ApprovalEngineService } from './approval.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Approval])],
  providers: [ApprovalEngineService],
  exports: [ApprovalEngineService],
})
export class ApprovalModule {}
