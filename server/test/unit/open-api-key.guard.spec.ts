import { afterEach, describe, expect, it } from 'vitest';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OpenApiKeyGuard } from '../../src/modules/openapi/open-api-key.guard';

function context(headers: Record<string, string>) {
  const req: any = { headers };
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any,
  };
}

describe('OpenApiKeyGuard', () => {
  const original = process.env.MES_OPEN_API_KEYS;

  afterEach(() => {
    if (original === undefined) delete process.env.MES_OPEN_API_KEYS;
    else process.env.MES_OPEN_API_KEYS = original;
  });

  it('fails closed when no machine keys are configured', () => {
    delete process.env.MES_OPEN_API_KEYS;
    expect(() => new OpenApiKeyGuard().canActivate(context({}).context))
      .toThrow(ServiceUnavailableException);
  });

  it('rejects an invalid key', () => {
    process.env.MES_OPEN_API_KEYS = 'u8=expected-key';
    expect(() => new OpenApiKeyGuard().canActivate(
      context({ 'x-mes-api-key': 'wrong-key' }).context,
    )).toThrow(UnauthorizedException);
  });

  it('accepts a valid key and records the integration client', () => {
    process.env.MES_OPEN_API_KEYS = 'u8=expected-key,crm=other-key';
    const request = context({ 'x-mes-api-key': 'expected-key' });
    expect(new OpenApiKeyGuard().canActivate(request.context)).toBe(true);
    expect(request.req.integrationClient).toBe('u8');
  });
});
