import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Approval, ApprovalStep } from './approval.entity';
import { ApprovalStatus } from '../enums';
import { BizException } from '../exceptions';

export interface CreateStepInput {
  approverRole?: string;
  userId?: string;
}

/**
 * 审批引擎。
 * 硬约束：
 *  - 禁止自审：任何 step 的审批人 == 申请人，create 直接拒绝；approve 时再兜底校验。
 *  - 多级/双审批：所有 step 依次 APPROVED 后单据才 APPROVED；任一驳回则 REJECTED。
 */
@Injectable()
export class ApprovalEngineService {
  constructor(
    @InjectRepository(Approval)
    private readonly repo: Repository<Approval>,
  ) {}

  async create(
    bizType: string,
    bizId: string,
    applicantId: string,
    steps: CreateStepInput[],
  ): Promise<Approval> {
    if (!steps?.length) {
      throw new BizException('APPROVAL_STEPS_EMPTY', 'Approval requires at least one step');
    }
    for (const s of steps) {
      if (!s.userId && !s.approverRole) {
        throw new BizException(
          'APPROVAL_STEP_INVALID',
          'Each step needs approverRole or userId',
        );
      }
      if (s.userId && s.userId === applicantId) {
        throw new BizException(
          'SELF_APPROVAL_FORBIDDEN',
          'Approver cannot be the applicant (self-approval forbidden)',
        );
      }
    }
    const entity = this.repo.create({
      bizType,
      bizId,
      applicantId,
      steps: JSON.stringify(
        steps.map((s) => ({
          approverRole: s.approverRole,
          userId: s.userId,
          status: 'PENDING',
        })),
      ),
      currentStep: 0,
      status: ApprovalStatus.PENDING,
    });
    return this.repo.save(entity);
  }

  /** @param userRoles 当前操作人拥有的角色码（用于按角色审批的 step） */
  async approve(id: number, userId: string, userRoles: string[] = [], comment?: string) {
    const ap = await this.mustGet(id);
    this.assertPending(ap);
    const steps = this.parseSteps(ap);
    const step = steps[ap.currentStep];
    this.assertApprover(step, ap, userId, userRoles);

    step.status = 'APPROVED';
    step.actedBy = userId;
    step.actedAt = new Date().toISOString();
    step.comment = comment;

    if (ap.currentStep === steps.length - 1) {
      ap.status = ApprovalStatus.APPROVED;
    } else {
      ap.currentStep += 1;
    }
    ap.steps = JSON.stringify(steps);
    return this.repo.save(ap);
  }

  async reject(
    id: number,
    userId: string,
    userRoles: string[] = [],
    reason?: string,
  ) {
    const ap = await this.mustGet(id);
    this.assertPending(ap);
    const steps = this.parseSteps(ap);
    const step = steps[ap.currentStep];
    this.assertApprover(step, ap, userId, userRoles);

    step.status = 'REJECTED';
    step.actedBy = userId;
    step.actedAt = new Date().toISOString();
    step.comment = reason;
    ap.status = ApprovalStatus.REJECTED;
    ap.rejectReason = reason ?? null;
    ap.steps = JSON.stringify(steps);
    return this.repo.save(ap);
  }

  async withdraw(id: number, applicantId: string) {
    const ap = await this.mustGet(id);
    if (ap.applicantId !== applicantId) {
      throw new BizException('NOT_APPLICANT', 'Only the applicant can withdraw');
    }
    this.assertPending(ap);
    ap.status = ApprovalStatus.WITHDRAWN;
    return this.repo.save(ap);
  }

  async get(id: number): Promise<Approval> {
    return this.mustGet(id);
  }

  private async mustGet(id: number): Promise<Approval> {
    const ap = await this.repo.findOne({ where: { id } });
    if (!ap) throw new BizException('APPROVAL_NOT_FOUND', `Approval ${id} not found`);
    return ap;
  }

  private assertPending(ap: Approval) {
    if (ap.status !== ApprovalStatus.PENDING) {
      throw new BizException(
        'APPROVAL_NOT_PENDING',
        `Approval ${ap.id} is ${ap.status}, cannot act`,
      );
    }
  }

  private assertApprover(
    step: ApprovalStep,
    ap: Approval,
    userId: string,
    userRoles: string[],
  ) {
    if (userId === ap.applicantId) {
      throw new BizException(
        'SELF_APPROVAL_FORBIDDEN',
        'Approver cannot be the applicant (self-approval forbidden)',
      );
    }
    if (step.userId && step.userId !== userId) {
      throw new BizException(
        'NOT_CURRENT_APPROVER',
        `Current step requires approver ${step.userId}`,
      );
    }
    if (!step.userId && step.approverRole && !userRoles.includes(step.approverRole)) {
      throw new BizException(
        'NOT_CURRENT_APPROVER',
        `Current step requires role ${step.approverRole}`,
      );
    }
  }

  private parseSteps(ap: Approval): ApprovalStep[] {
    return JSON.parse(ap.steps);
  }
}
