import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import { BizException } from '../../common/exceptions';
import { CurrentUserPayload } from '../auth/current-user.decorator';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { TempGrant } from './entities/temp-grant.entity';
import { User } from './entities/user.entity';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(TempGrant)
    private readonly grantRepo: Repository<TempGrant>,
    private readonly audit: AuditService,
  ) {}

  async users() {
    const users = await this.userRepo.find({ order: { username: 'ASC' } });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      disabled: user.disabled,
      dingtalkBound: Boolean(user.dingtalkUnionId),
      roles: (user.roles ?? []).map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
      })),
      createdAt: user.createdAt,
    }));
  }

  roles() {
    return this.roleRepo.find({ order: { code: 'ASC' } });
  }

  permissions() {
    return this.permissionRepo.find({ order: { code: 'ASC' } });
  }

  async tempGrants() {
    const [grants, users] = await Promise.all([
      this.grantRepo.find({ order: { expiresAt: 'DESC' } }),
      this.userRepo.find(),
    ]);
    const usernames = new Map(users.map((user) => [user.id, user.username]));
    return grants.map((grant) => ({
      id: grant.id,
      userId: grant.userId,
      username: usernames.get(grant.userId) ?? null,
      permissionCode: grant.permissionCode,
      expiresAt: grant.expiresAt,
      grantedBy: grant.grantedBy,
      createdAt: grant.createdAt,
    }));
  }

  async createTempGrant(
    input: { userId: number; permissionCode: string; expiresAt: string },
    operator: CurrentUserPayload,
  ) {
    const [user, permission] = await Promise.all([
      this.userRepo.findOne({ where: { id: input.userId } }),
      this.permissionRepo.findOne({ where: { code: input.permissionCode } }),
    ]);
    if (!user) {
      throw new BizException('RBAC_USER_NOT_FOUND', `User ${input.userId} not found`, 404);
    }
    if (!permission) {
      throw new BizException(
        'RBAC_PERMISSION_NOT_FOUND',
        `Permission ${input.permissionCode} not found`,
        404,
      );
    }
    if (permission.code === '*') {
      throw new BizException(
        'RBAC_TEMP_GRANT_WILDCARD_FORBIDDEN',
        '临时授权不允许授予超级权限',
      );
    }
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BizException('RBAC_GRANT_EXPIRES_INVALID', '到期时间必须晚于当前时间');
    }
    const existing = await this.grantRepo.findOne({
      where: {
        userId: user.id,
        permissionCode: permission.code,
        expiresAt: MoreThan(new Date()),
      },
    });
    if (existing) {
      existing.expiresAt = expiresAt;
      existing.grantedBy = operator.username;
      const saved = await this.grantRepo.save(existing);
      await this.audit.log({
        operator: operator.username,
        role: operator.roles.join(','),
        action: 'rbac.temp-grant.extend',
        docNo: user.username,
        after: { permissionCode: permission.code, expiresAt },
        result: 'SUCCESS',
      });
      return saved;
    }
    const grant = await this.grantRepo.save(
      this.grantRepo.create({
        userId: user.id,
        permissionCode: permission.code,
        expiresAt,
        grantedBy: operator.username,
      }),
    );
    await this.audit.log({
      operator: operator.username,
      role: operator.roles.join(','),
      action: 'rbac.temp-grant.create',
      docNo: user.username,
      after: { permissionCode: permission.code, expiresAt },
      result: 'SUCCESS',
    });
    return grant;
  }

  async revokeTempGrant(grantId: number, operator: CurrentUserPayload) {
    const grant = await this.grantRepo.findOne({ where: { id: grantId } });
    if (!grant) {
      throw new BizException('RBAC_GRANT_NOT_FOUND', `Grant ${grantId} not found`, 404);
    }
    const user = await this.userRepo.findOne({ where: { id: grant.userId } });
    await this.grantRepo.remove(grant);
    await this.audit.log({
      operator: operator.username,
      role: operator.roles.join(','),
      action: 'rbac.temp-grant.revoke',
      docNo: user?.username ?? String(grant.userId),
      before: {
        permissionCode: grant.permissionCode,
        expiresAt: grant.expiresAt,
      },
      result: 'SUCCESS',
    });
    return { revoked: true, id: grantId };
  }

  async unbindDingTalkUser(userId: number, operator: CurrentUserPayload) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BizException('RBAC_USER_NOT_FOUND', `User ${userId} not found`, 404);
    }
    const before = { dingtalkBound: Boolean(user.dingtalkUnionId) };
    user.dingtalkUnionId = null;
    user.dingtalkOpenId = null;
    user.dingtalkNick = null;
    user.dingtalkAvatarUrl = null;
    user.dingtalkBoundAt = null;
    await this.userRepo.save(user);
    await this.audit.log({
      operator: operator.username,
      role: operator.roles.join(','),
      action: 'rbac.user.dingtalk.unbind',
      docNo: user.username,
      before,
      after: { dingtalkBound: false },
      result: 'SUCCESS',
    });
    return { id: user.id, username: user.username, dingtalkBound: false };
  }

  async assignUserRoles(
    userId: number,
    requestedRoles: (number | string)[],
    operator: CurrentUserPayload,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BizException('RBAC_USER_NOT_FOUND', `User ${userId} not found`, 404);
    }

    const allRoles = await this.roleRepo.find();
    const requestedKeys = [...new Set((requestedRoles ?? []).map(String))];
    const roles = allRoles.filter(
      (role) =>
        requestedKeys.includes(String(role.id)) ||
        requestedKeys.includes(role.code) ||
        requestedKeys.includes(role.name),
    );
    const matchedKeys = new Set<string>();
    for (const role of roles) {
      matchedKeys.add(String(role.id));
      matchedKeys.add(role.code);
      matchedKeys.add(role.name);
    }
    const unknown = requestedKeys.filter((key) => !matchedKeys.has(key));
    if (unknown.length) {
      throw new BizException(
        'RBAC_ROLE_NOT_FOUND',
        `Unknown role(s): ${unknown.join(', ')}`,
      );
    }

    const before = (user.roles ?? []).map((role) => role.code).sort();
    user.roles = roles;
    await this.userRepo.save(user);
    const after = roles.map((role) => role.code).sort();
    await this.audit.log({
      operator: operator.username,
      role: operator.roles.join(','),
      action: 'rbac.user.roles.assign',
      docNo: user.username,
      before: { roles: before },
      after: { roles: after },
      result: 'SUCCESS',
    });
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      disabled: user.disabled,
      roles: roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
      })),
    };
  }
}
