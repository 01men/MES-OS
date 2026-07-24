import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers';
import { ApprovalEngineService } from '../../src/common/approval/approval.service';
import { Approval } from '../../src/common/approval/approval.entity';
import { ApprovalStatus } from '../../src/common/enums';
import { BizException } from '../../src/common/exceptions';

describe('ApprovalEngineService 审批引擎', () => {
  let ds: DataSource;
  let svc: ApprovalEngineService;

  beforeEach(async () => {
    ds = await createTestDataSource();
    svc = new ApprovalEngineService(ds.getRepository(Approval));
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('自审被拒：create 时 step 审批人 == 申请人直接拒绝', async () => {
    await expect(
      svc.create('PREP', 'PREP-1', 'user1', [{ userId: 'user1' }]),
    ).rejects.toThrow(BizException);
    await expect(
      svc.create('PREP', 'PREP-1', 'user1', [{ userId: 'user1' }]),
    ).rejects.toThrow(/self-approval/i);
  });

  it('双审批：乱序审批被拒，两个 step 都过才 APPROVED', async () => {
    const ap = await svc.create('PREP', 'PREP-2', 'user1', [
      { userId: 'user2' },
      { userId: 'user3' },
    ]);
    expect(ap.status).toBe(ApprovalStatus.PENDING);

    // user3 不是当前 step 审批人
    await expect(svc.approve(ap.id, 'user3')).rejects.toThrow(BizException);
    // 申请人不能审批
    await expect(svc.approve(ap.id, 'user1')).rejects.toThrow(/self-approval/i);

    const after1 = await svc.approve(ap.id, 'user2');
    expect(after1.status).toBe(ApprovalStatus.PENDING);
    expect(after1.currentStep).toBe(1);

    const after2 = await svc.approve(ap.id, 'user3');
    expect(after2.status).toBe(ApprovalStatus.APPROVED);
  });

  it('按角色审批：具备对应角色才可通过', async () => {
    const ap = await svc.create('PREP', 'PREP-3', 'user1', [
      { approverRole: 'WH_MANAGER' },
    ]);
    await expect(svc.approve(ap.id, 'user9', ['KEEPER'])).rejects.toThrow(BizException);
    const done = await svc.approve(ap.id, 'user9', ['WH_MANAGER']);
    expect(done.status).toBe(ApprovalStatus.APPROVED);
  });

  it('驳回置回：REJECTED 后不可再审批', async () => {
    const ap = await svc.create('PREP', 'PREP-4', 'user1', [{ userId: 'user2' }]);
    const rejected = await svc.reject(ap.id, 'user2', [], '数量有误');
    expect(rejected.status).toBe(ApprovalStatus.REJECTED);
    expect(rejected.rejectReason).toBe('数量有误');
    await expect(svc.approve(ap.id, 'user2')).rejects.toThrow(BizException);
  });

  it('撤回：仅申请人可撤回，且仅 PENDING 状态', async () => {
    const ap = await svc.create('PREP', 'PREP-5', 'user1', [{ userId: 'user2' }]);
    await expect(svc.withdraw(ap.id, 'user9')).rejects.toThrow(BizException);
    const withdrawn = await svc.withdraw(ap.id, 'user1');
    expect(withdrawn.status).toBe(ApprovalStatus.WITHDRAWN);
    await expect(svc.withdraw(ap.id, 'user1')).rejects.toThrow(BizException);
  });
});
