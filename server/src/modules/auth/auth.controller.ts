import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CurrentUser, CurrentUserPayload } from './current-user.decorator';
import { DingTalkService } from './dingtalk.service';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly dingtalk: DingTalkService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }

  @Public()
  @Get('config')
  config() {
    return this.dingtalk.configView();
  }

  @Public()
  @Get('dingtalk/login-url')
  async dingtalkLoginUrl(@Req() req: Request) {
    const origin = this.publicOrigin(req);
    const state = await this.dingtalk.createState('login', null, origin);
    const redirectUri = `${origin}/api/auth/dingtalk/callback`;
    return {
      url: this.dingtalk.buildAuthorizeUrl(redirectUri, state.token),
      expiresAt: state.expiresAt,
    };
  }

  @Get('dingtalk/bind-url')
  async dingtalkBindUrl(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const origin = this.publicOrigin(req);
    const state = await this.dingtalk.createState('bind', Number(user.id), origin);
    const redirectUri = `${origin}/api/auth/dingtalk/callback`;
    return {
      url: this.dingtalk.buildAuthorizeUrl(redirectUri, state.token),
      expiresAt: state.expiresAt,
    };
  }

  @Public()
  @Get('dingtalk/callback')
  async dingtalkCallback(
    @Query('authCode') authCode: string | undefined,
    @Query('code') code: string | undefined,
    @Query('state') stateToken: string | undefined,
    @Res() res: Response,
  ) {
    let origin = process.env.MES_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') ||
      'http://127.0.0.1:5173';
    try {
      if (!stateToken) throw new Error('钉钉未返回登录状态');
      const state = await this.dingtalk.consumeState(stateToken);
      origin = state.publicOrigin;
      const returnedCode = authCode || code;
      if (!returnedCode) throw new Error('钉钉未返回授权码');
      const info = await this.dingtalk.exchangeAuthCode(returnedCode);

      if (state.mode === 'bind') {
        if (!state.userId) throw new Error('绑定会话无效');
        await this.auth.bindDingTalk(state.userId, info);
        return res.redirect(302, `${origin}/pc/dashboard?dingtalk=bound`);
      }

      const session = await this.auth.loginByDingTalk(info);
      const hash = new URLSearchParams({
        dingtalk_token: session.token,
        dingtalk_user: JSON.stringify(session.user),
      });
      return res.redirect(302, `${origin}/login#${hash.toString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.redirect(
        302,
        `${origin}/login?dingtalk_error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Post('dingtalk/unbind')
  unbindDingTalk(@CurrentUser() user: CurrentUserPayload) {
    return this.auth.unbindDingTalk(
      Number(user.id),
      user.username,
      user.roles,
    );
  }

  private publicOrigin(req: Request): string {
    const configured = process.env.MES_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
    if (configured) {
      const url = new URL(configured);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('MES_PUBLIC_ORIGIN 必须使用 http 或 https');
      }
      return url.origin;
    }
    if (process.env.NODE_ENV !== 'production') return 'http://127.0.0.1:5173';
    const forwardedHost =
      process.env.MES_TRUST_PROXY === '1'
        ? req.header('x-forwarded-host')?.split(',')[0]?.trim()
        : undefined;
    const host = forwardedHost || req.header('host');
    if (!host) throw new Error('无法确定钉钉回调域名，请配置 MES_PUBLIC_ORIGIN');
    const forwardedProto =
      process.env.MES_TRUST_PROXY === '1'
        ? req.header('x-forwarded-proto')?.split(',')[0]?.trim()
        : undefined;
    return `${forwardedProto || req.protocol}://${host}`;
  }
}
