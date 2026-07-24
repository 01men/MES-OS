import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../helpers';
import { DingTalkAuthState } from '../../src/modules/auth/dingtalk-auth-state.entity';
import { DingTalkService } from '../../src/modules/auth/dingtalk.service';

describe('DingTalkService', () => {
  let ds: DataSource;
  let service: DingTalkService;
  const oldClientId = process.env.MES_DINGTALK_CLIENT_ID;
  const oldClientSecret = process.env.MES_DINGTALK_CLIENT_SECRET;

  beforeEach(async () => {
    process.env.MES_DINGTALK_CLIENT_ID = 'ding-unit-test';
    process.env.MES_DINGTALK_CLIENT_SECRET = 'unit-secret';
    ds = await createTestDataSource();
    service = new DingTalkService(ds.getRepository(DingTalkAuthState));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await ds.destroy();
    if (oldClientId === undefined) delete process.env.MES_DINGTALK_CLIENT_ID;
    else process.env.MES_DINGTALK_CLIENT_ID = oldClientId;
    if (oldClientSecret === undefined) delete process.env.MES_DINGTALK_CLIENT_SECRET;
    else process.env.MES_DINGTALK_CLIENT_SECRET = oldClientSecret;
  });

  it('生成标准 OAuth2 URL，state 只能消费一次', async () => {
    const state = await service.createState(
      'login',
      null,
      'http://127.0.0.1:5173',
    );
    const url = new URL(
      service.buildAuthorizeUrl(
        'http://127.0.0.1:5173/api/auth/dingtalk/callback',
        state.token,
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.dingtalk.com/oauth2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe('ding-unit-test');
    expect(url.searchParams.get('state')).toBe(state.token);
    expect(url.searchParams.get('scope')).toBe('openid');

    const consumed = await service.consumeState(state.token);
    expect(consumed.consumedAt).toBeInstanceOf(Date);
    await expect(service.consumeState(state.token)).rejects.toThrow(
      '钉钉登录状态已过期',
    );
  });

  it('按钉钉新版接口交换 access token 与当前用户', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          unionId: 'union-001',
          openId: 'open-001',
          nick: '测试用户',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const info = await service.exchangeAuthCode('auth-code');
    expect(info).toMatchObject({
      unionId: 'union-001',
      openId: 'open-001',
      nick: '测试用户',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      'x-acs-dingtalk-access-token': 'access-token',
    });
  });
});

