import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
