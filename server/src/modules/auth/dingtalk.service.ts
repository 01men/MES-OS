import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import {
  DingTalkAuthMode,
  DingTalkAuthState,
} from './dingtalk-auth-state.entity';
import { DingTalkConfig } from './dingtalk-config.entity';

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
    @InjectRepository(DingTalkConfig)
    private readonly configRepo: Repository<DingTalkConfig>,
    private readonly audit: AuditService,
  ) {}

  private envConfig() {
    const clientId = process.env.MES_DINGTALK_CLIENT_ID?.trim() ?? '';
    const clientSecret = process.env.MES_DINGTALK_CLIENT_SECRET?.trim() ?? '';
    return {
      enabled: Boolean(clientId && clientSecret),
      clientId,
      clientSecret,
      publicOrigin:
        process.env.MES_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') ?? '',
    };
  }

  private encryptionKey(): Buffer {
    const source =
      process.env.MES_CONFIG_ENCRYPTION_KEY?.trim() ||
      process.env.MES_JWT_SECRET?.trim() ||
      'mes-dev-config-key-change-in-production';
    return createHash('sha256').update(source).digest();
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decrypt(value: string): string {
    const [version, ivRaw, tagRaw, encryptedRaw] = value.split('.');
    if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
      throw new Error('钉钉密钥密文格式无效');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private async runtimeConfig() {
    const env = this.envConfig();
    const stored = await this.configRepo.findOne({ where: { id: 1 } });
    if (!stored) return { ...env, source: 'environment' as const };
    let storedSecret = '';
    if (stored.clientSecretEncrypted) {
      storedSecret = this.decrypt(stored.clientSecretEncrypted);
    }
    return {
      enabled: stored.enabled,
      clientId: stored.clientId?.trim() || env.clientId,
      clientSecret: storedSecret || env.clientSecret,
      publicOrigin: stored.publicOrigin?.trim() || env.publicOrigin,
      source: 'database' as const,
    };
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.runtimeConfig();
    return Boolean(config.enabled && config.clientId && config.clientSecret);
  }

  async configView() {
    const config = await this.runtimeConfig();
    return {
      dingtalkEnabled: Boolean(
        config.enabled && config.clientId && config.clientSecret,
      ),
      dingtalkClientId: config.clientId,
    };
  }

  async adminConfigView(fallbackOrigin: string) {
    const config = await this.runtimeConfig();
    const publicOrigin = config.publicOrigin || fallbackOrigin;
    return {
      enabled: config.enabled,
      ready: Boolean(
        config.enabled && config.clientId && config.clientSecret,
      ),
      clientId: config.clientId,
      hasSecret: Boolean(config.clientSecret),
      publicOrigin,
      callbackUrl: `${publicOrigin}/api/auth/dingtalk/callback`,
      source: config.source,
    };
  }

  async saveConfig(
    input: {
      enabled?: boolean;
      clientId?: string;
      clientSecret?: string;
      clearSecret?: boolean;
      publicOrigin?: string;
    },
    operator: string,
    operatorRoles: string[],
    fallbackOrigin: string,
  ) {
    const before = await this.adminConfigView(fallbackOrigin);
    let row = await this.configRepo.findOne({ where: { id: 1 } });
    if (!row) {
      const env = this.envConfig();
      row = this.configRepo.create({
        id: 1,
        enabled: env.enabled,
        clientId: env.clientId || null,
        clientSecretEncrypted: env.clientSecret
          ? this.encrypt(env.clientSecret)
          : null,
        publicOrigin: env.publicOrigin || null,
        updatedBy: operator,
      });
    }
    if (input.clientId !== undefined) {
      const clientId = input.clientId.trim();
      if (clientId && !/^ding[a-zA-Z0-9_-]+$/.test(clientId)) {
        throw new BadRequestException(
          'Client ID（AppKey）格式不正确，应以 ding 开头',
        );
      }
      row.clientId = clientId || null;
    }
    if (input.clearSecret) row.clientSecretEncrypted = null;
    if (input.clientSecret?.trim()) {
      row.clientSecretEncrypted = this.encrypt(input.clientSecret.trim());
    }
    if (input.publicOrigin !== undefined) {
      const origin = input.publicOrigin.trim().replace(/\/+$/, '');
      if (origin) {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new BadRequestException('公开访问地址必须使用 http 或 https');
        }
        row.publicOrigin = parsed.origin;
      } else {
        row.publicOrigin = null;
      }
    }
    if (input.enabled !== undefined) row.enabled = input.enabled;
    row.updatedBy = operator;
    const env = this.envConfig();
    const effectiveClientId = row.clientId?.trim() || env.clientId;
    const effectiveSecret = row.clientSecretEncrypted
      ? this.decrypt(row.clientSecretEncrypted)
      : env.clientSecret;
    if (row.enabled && !(effectiveClientId && effectiveSecret)) {
      throw new BadRequestException(
        '启用钉钉登录前必须配置 Client ID 和 Client Secret',
      );
    }
    await this.configRepo.save(row);
    const after = await this.adminConfigView(fallbackOrigin);
    await this.audit.log({
      operator,
      role: operatorRoles.join(','),
      action: 'auth.dingtalk.config.update',
      docNo: 'DINGTALK',
      before: {
        enabled: before.enabled,
        clientId: before.clientId,
        hasSecret: before.hasSecret,
        publicOrigin: before.publicOrigin,
      },
      after: {
        enabled: after.enabled,
        clientId: after.clientId,
        hasSecret: after.hasSecret,
        publicOrigin: after.publicOrigin,
      },
      result: 'SUCCESS',
    });
    return after;
  }

  async configuredPublicOrigin(): Promise<string> {
    return (await this.runtimeConfig()).publicOrigin;
  }

  async buildAuthorizeUrl(redirectUri: string, state: string): Promise<string> {
    const config = await this.runtimeConfig();
    if (!(config.enabled && config.clientId && config.clientSecret)) {
      throw new BadRequestException('钉钉登录未配置或未启用');
    }
    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: 'code',
      client_id: config.clientId,
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
    const config = await this.runtimeConfig();
    if (!(config.enabled && config.clientId && config.clientSecret)) {
      throw new BadRequestException('钉钉登录未配置或未启用');
    }
    const tokenResponse = await fetch(
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
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
