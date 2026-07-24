import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../../common/audit/audit.service';
import { BizException } from '../../common/exceptions';
import { User } from '../rbac/entities/user.entity';
import { DingTalkUserInfo } from './dingtalk.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user || user.disabled) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid username or password');
    return this.issueToken(user);
  }

  async issueToken(user: User) {
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });
    const permissions = new Set<string>();
    for (const role of user.roles ?? []) {
      for (const permission of role.permissions ?? []) {
        permissions.add(permission.code);
      }
    }
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: (user.roles ?? []).map((r) => r.code),
        perms: [...permissions],
        dingtalkBound: Boolean(user.dingtalkUnionId),
        avatarUrl: user.dingtalkAvatarUrl,
      },
    };
  }

  async loginByDingTalk(info: DingTalkUserInfo) {
    const user = await this.userRepo.findOne({
      where: { dingtalkUnionId: info.unionId, disabled: false },
    });
    if (!user) {
      throw new UnauthorizedException(
        '该钉钉账号尚未绑定 MES 用户，请先使用账号密码登录后绑定',
      );
    }
    user.dingtalkOpenId = info.openId ?? user.dingtalkOpenId;
    user.dingtalkNick = info.nick ?? user.dingtalkNick;
    user.dingtalkAvatarUrl = info.avatarUrl ?? user.dingtalkAvatarUrl;
    await this.userRepo.save(user);
    await this.audit.log({
      operator: user.username,
      role: (user.roles ?? []).map((role) => role.code).join(','),
      action: 'auth.dingtalk.login',
      docNo: user.username,
      result: 'SUCCESS',
    });
    return this.issueToken(user);
  }

  async bindDingTalk(userId: number, info: DingTalkUserInfo) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || user.disabled) {
      throw new UnauthorizedException('用户不存在或已停用');
    }
    const bound = await this.userRepo.findOne({
      where: { dingtalkUnionId: info.unionId },
    });
    if (bound && bound.id !== user.id) {
      throw new BizException(
        'DINGTALK_ALREADY_BOUND',
        '该钉钉账号已绑定其他 MES 用户',
        409,
      );
    }
    const before = { dingtalkBound: Boolean(user.dingtalkUnionId) };
    user.dingtalkUnionId = info.unionId;
    user.dingtalkOpenId = info.openId ?? null;
    user.dingtalkNick = info.nick ?? null;
    user.dingtalkAvatarUrl = info.avatarUrl ?? null;
    user.dingtalkBoundAt = new Date();
    await this.userRepo.save(user);
    await this.audit.log({
      operator: user.username,
      role: (user.roles ?? []).map((role) => role.code).join(','),
      action: 'auth.dingtalk.bind',
      docNo: user.username,
      before,
      after: { dingtalkBound: true, nick: user.dingtalkNick },
      result: 'SUCCESS',
    });
    return { id: user.id, username: user.username, dingtalkBound: true };
  }

  async unbindDingTalk(userId: number, operator: string, operatorRoles: string[]) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BizException('RBAC_USER_NOT_FOUND', `User ${userId} not found`, 404);
    }
    const wasBound = Boolean(user.dingtalkUnionId);
    user.dingtalkUnionId = null;
    user.dingtalkOpenId = null;
    user.dingtalkNick = null;
    user.dingtalkAvatarUrl = null;
    user.dingtalkBoundAt = null;
    await this.userRepo.save(user);
    await this.audit.log({
      operator,
      role: operatorRoles.join(','),
      action: 'auth.dingtalk.unbind',
      docNo: user.username,
      before: { dingtalkBound: wasBound },
      after: { dingtalkBound: false },
      result: 'SUCCESS',
    });
    return { id: user.id, username: user.username, dingtalkBound: false };
  }
}
