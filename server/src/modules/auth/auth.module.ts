import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RbacModule } from '../rbac/rbac.module';
import { PermissionGuard } from '../rbac/permission.guard';
import { TempGrant } from '../rbac/entities/temp-grant.entity';
import { DingTalkAuthState } from './dingtalk-auth-state.entity';
import { DingTalkService } from './dingtalk.service';

export const JWT_SECRET = process.env.MES_JWT_SECRET || 'mes-dev-secret-change-in-prod';

@Module({
  imports: [
    RbacModule,
    TypeOrmModule.forFeature([TempGrant, DingTalkAuthState]),
    JwtModule.register({
      global: true,
      secret: JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    DingTalkService,
    // 顺序固定：先认证，再鉴权
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, DingTalkService],
})
export class AuthModule {}
