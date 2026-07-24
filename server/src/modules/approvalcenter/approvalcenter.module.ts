import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Approval } from '../../common/approval/approval.entity';
import { User } from '../rbac/entities/user.entity';
import { ApprovalCenterController } from './approvalcenter.controller';

/** 审批中心 REST（实体复用 common/approval 的 Approval，不新建表） */
@Module({
  imports: [TypeOrmModule.forFeature([Approval, User])],
  controllers: [ApprovalCenterController],
})
export class ApprovalcenterModule {}
