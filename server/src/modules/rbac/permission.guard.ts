import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { REQUIRE_PERM_KEY } from './require-perm.decorator';
import { TempGrant } from './entities/temp-grant.entity';

/**
 * 权限守卫：读 @RequirePerm 元数据；无元数据则只需登录。
 * 权限来源 = 角色权限 ∪ 未过期临时授权；'*' 为超级权限。
 * 依赖 AuthGuard 先执行（同在 AuthModule providers 中按序注册）。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(TempGrant)
    private readonly grantRepo: Repository<TempGrant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(REQUIRE_PERM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const perms = new Set<string>(user.permissions ?? []);
    const grants = await this.grantRepo.find({
      where: { userId: user.id, expiresAt: MoreThan(new Date()) },
    });
    for (const g of grants) perms.add(g.permissionCode);

    if (perms.has('*') || perms.has(required)) return true;
    throw new ForbiddenException(`Missing permission: ${required}`);
  }
}
