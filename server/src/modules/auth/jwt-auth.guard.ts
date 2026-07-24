import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from './public.decorator';
import { User } from '../rbac/entities/user.entity';
import { DataScope } from '../../common/enums';

/**
 * 全局 JWT 守卫：除 @Public() 接口外一律要求 Bearer token。
 * 校验通过后把用户（含角色/权限码）挂到 req.user 供 PermissionGuard 使用。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const user = await this.userRepo.findOne({
      where: { id: payload.sub, disabled: false },
    });
    if (!user) throw new UnauthorizedException('User not found or disabled');

    const permissions = new Set<string>();
    for (const role of user.roles ?? []) {
      for (const p of role.permissions ?? []) permissions.add(p.code);
    }
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      roles: (user.roles ?? []).map((r) => r.code),
      permissions: [...permissions],
      dataScopes: [...new Set((user.roles ?? []).map((r) => r.dataScope))],
      warehouseCodes: [...new Set(user.warehouseCodes ?? [])],
      allWarehouseAccess:
        permissions.has('*') ||
        (user.roles ?? []).some((r) => r.dataScope === DataScope.ALL),
    };
    return true;
  }
}
