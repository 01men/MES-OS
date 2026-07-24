import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Approval, ApprovalStep } from '../../common/approval/approval.entity';
import { ApprovalEngineService } from '../../common/approval/approval.service';
import { ApprovalStatus } from '../../common/enums';
import { AuditService } from '../../common/audit/audit.service';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { RequirePerm } from '../rbac/require-perm.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/current-user.decorator';
import { User } from '../rbac/entities/user.entity';

export interface ApprovalStepDto {
  seq: number;
  approverRole?: string;
  userId?: string;
  status: string;
  comment?: string;
  actedAt?: string;
}

export interface ApprovalDto {
  id: number;
  bizType: string;
  bizId: string;
  applicantId: string;
  applicantName: string;
  status: ApprovalStatus;
  steps: ApprovalStepDto[];
  createdAt: Date;
}

/**
 * 审批中心（阶段七）：统一待办/已办/我发起的/全部查询 + 通过/驳回。
 * 审批流转全部委托 ApprovalEngineService（自审拦截等硬约束沿用引擎）。
 */
@Controller('approval')
export class ApprovalCenterController {
  constructor(
    @InjectRepository(Approval)
    private readonly repo: Repository<Approval>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly engine: ApprovalEngineService,
    private readonly audit: AuditService,
  ) {}

  /** 待办：当前用户账号/角色匹配当前 step 且单据 PENDING */
  @Get('todo')
  @RequirePerm('approval.read')
  async todo(@CurrentUser() user: CurrentUserPayload) {
    const pendings = await this.repo.find({
      where: { status: ApprovalStatus.PENDING },
      order: { id: 'DESC' },
    });
    const matched = pendings.filter((ap) => {
      const step = this.parseSteps(ap)[ap.currentStep];
      if (!step) return false;
      if (step.userId) return step.userId === user.username;
      if (step.approverRole) return user.roles.includes(step.approverRole);
      return false;
    });
    return this.toDtos(matched);
  }

  /** 已办：任一 step 由当前用户执行过 */
  @Get('done')
  @RequirePerm('approval.read')
  async done(@CurrentUser() user: CurrentUserPayload) {
    const all = await this.repo.find({ order: { id: 'DESC' } });
    const matched = all.filter((ap) =>
      this.parseSteps(ap).some((s) => s.actedBy === user.username),
    );
    return this.toDtos(matched);
  }

  /** 我发起的（任何登录用户均可查自己的） */
  @Get('mine')
  async mine(@CurrentUser('username') username: string) {
    const list = await this.repo.find({
      where: { applicantId: username },
      order: { id: 'DESC' },
    });
    return this.toDtos(list);
  }

  /** 全部（仅 ADMIN 角色） */
  @Get('all')
  @RequirePerm('approval.read')
  async all(@CurrentUser() user: CurrentUserPayload) {
    if (!user.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only ADMIN can list all approvals');
    }
    const list = await this.repo.find({ order: { id: 'DESC' } });
    return this.toDtos(list);
  }

  @Post(':id/approve')
  @RequirePerm('approval.operate')
  @Idempotent('approvalcenter.approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { comment?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const ap = await this.engine.approve(
      Number(id),
      user.username,
      user.roles,
      body?.comment,
    );
    await this.audit.log({
      operator: user.username,
      role: user.roles.join(','),
      action: 'approval.approve',
      docNo: ap.bizId,
      after: { id: ap.id, bizType: ap.bizType, status: ap.status },
      result: 'SUCCESS',
    });
    const [dto] = await this.toDtos([ap]);
    return dto;
  }

  @Post(':id/reject')
  @RequirePerm('approval.operate')
  @Idempotent('approvalcenter.reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const ap = await this.engine.reject(
      Number(id),
      user.username,
      user.roles,
      body?.reason,
    );
    await this.audit.log({
      operator: user.username,
      role: user.roles.join(','),
      action: 'approval.reject',
      docNo: ap.bizId,
      after: { id: ap.id, bizType: ap.bizType, status: ap.status },
      result: 'SUCCESS',
    });
    const [dto] = await this.toDtos([ap]);
    return dto;
  }

  private parseSteps(ap: Approval): ApprovalStep[] {
    return JSON.parse(ap.steps);
  }

  private async toDtos(list: Approval[]): Promise<ApprovalDto[]> {
    const applicantIds = [...new Set(list.map((a) => a.applicantId))];
    const users = applicantIds.length
      ? await this.userRepo.find({ where: { username: In(applicantIds) } })
      : [];
    const nameMap = new Map(users.map((u) => [u.username, u.name]));
    return list.map((ap) => ({
      id: ap.id,
      bizType: ap.bizType,
      bizId: ap.bizId,
      applicantId: ap.applicantId,
      applicantName: nameMap.get(ap.applicantId) ?? ap.applicantId,
      status: ap.status,
      steps: this.parseSteps(ap).map((s, i) => ({
        seq: i + 1,
        approverRole: s.approverRole,
        userId: s.userId,
        status: s.status,
        comment: s.comment,
        actedAt: s.actedAt,
      })),
      createdAt: ap.createdAt,
    }));
  }
}
