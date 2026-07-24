import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { TempGrant } from './entities/temp-grant.entity';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

export const RBAC_ENTITIES = [User, Role, Permission, TempGrant];

/**
 * RBAC 基础模块：实体 + @RequirePerm 装饰器 + PermissionGuard。
 * 全局守卫由 AuthModule 统一按序注册（JwtAuthGuard → PermissionGuard）。
 */
@Module({
  imports: [TypeOrmModule.forFeature(RBAC_ENTITIES)],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [TypeOrmModule, RbacService],
})
export class RbacModule {}
