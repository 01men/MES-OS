import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import {
  DingTalkAuthMode,
  DingTalkAuthState,
} from './dingtalk-auth-state.entity';

export interface DingTalkUserInfo {
  unionId: string;
  openId?: string;
  nick?: string;
  avatarUrl?: string;
  mobile?: string;
  email?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class DingTalkService {
  constructor(
    @InjectRepository(DingTalkAuthState)
    private readonly stateRepo: Repository<DingTalkAuthState>,
  ) {}

  private get clientId() {
    return process.env.MES_DINGTALK_CLIENT_ID?.trim() ?? '';
  }

  private get clientSecret() {
    return process.env.MES_DINGTALK_CLIENT_SECRET?.trim() ?? '';
  }

  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  configView() {
    return {
      dingtalkEnabled: this.isEnabled(),
      dingtalkClientId: this.clientId,
    };
  }

  buildAuthorizeUrl(redirectUri: string, state: string): string {
    if (!this.isEnabled()) {
      throw new BadRequestException('钉钉登录未配置或未启用');
    }
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: 'code',
      client_id: this.clientId,
      scope: 'openid',
      state,
      prompt: 'consent',
    });
    return `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
  }

  async createState(
    mode: DingTalkAuthMode,
    userId: number | null,
    publicOrigin: string,
  ): Promise<DingTalkAuthState> {
    await this.stateRepo.delete({ expiresAt: LessThan(new Date()) });
    return this.stateRepo.save(
      this.stateRepo.create({
        token: randomBytes(32).toString('hex'),
        mode,
        userId,
        publicOrigin,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
        consumedAt: null,
      }),
    );
  }

  async consumeState(token: string): Promise<DingTalkAuthState> {
    const state = await this.stateRepo.findOne({ where: { token } });
    if (
      !state ||
      state.consumedAt ||
      state.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException('钉钉登录状态已过期，请重新发起授权');
    }
    state.consumedAt = new Date();
    return this.stateRepo.save(state);
  }

  async exchangeAuthCode(authCode: string): Promise<DingTalkUserInfo> {
    if (!this.isEnabled()) {
      throw new BadRequestException('钉钉登录未配置或未启用');
    }
    const tokenResponse = await fetch(
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          code: authCode,
          grantType: 'authorization_code',
        }),
      },
    );
    const tokenBody = (await tokenResponse.json()) as {
      accessToken?: string;
      message?: string;
      code?: string;
    };
    if (!tokenResponse.ok || !tokenBody.accessToken) {
      throw new BadGatewayException(
        `钉钉授权码校验失败：${tokenBody.message ?? tokenBody.code ?? `HTTP ${tokenResponse.status}`}`,
      );
    }

    const meResponse = await fetch(
      'https://api.dingtalk.com/v1.0/contact/users/me',
      {
        headers: {
          'x-acs-dingtalk-access-token': tokenBody.accessToken,
        },
      },
    );
    const meBody = (await meResponse.json()) as DingTalkUserInfo & {
      message?: string;
      code?: string;
    };
    if (!meResponse.ok || !meBody.unionId) {
      throw new BadGatewayException(
        `获取钉钉用户信息失败：${meBody.message ?? meBody.code ?? `HTTP ${meResponse.status}`}`,
      );
    }
    return meBody;
  }
}
