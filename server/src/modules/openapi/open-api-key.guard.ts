import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

export function configuredOpenApiKeys(): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of (process.env.MES_OPEN_API_KEYS ?? '').split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const client = item.slice(0, separator).trim();
    const key = item.slice(separator + 1).trim();
    if (client && key) result.set(client, key);
  }
  return result;
}

@Injectable()
export class OpenApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const keys = configuredOpenApiKeys();
    if (!keys.size) {
      throw new ServiceUnavailableException(
        'Open API is disabled: MES_OPEN_API_KEYS is not configured',
      );
    }
    const req = context.switchToHttp().getRequest();
    const headerKey = String(req.headers['x-mes-api-key'] ?? '');
    const bearer = String(req.headers.authorization ?? '');
    const candidate = headerKey || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');
    if (!candidate) throw new UnauthorizedException('Missing X-MES-API-Key');

    for (const [client, expected] of keys) {
      if (timingSafeEqual(digest(candidate), digest(expected))) {
        req.integrationClient = client;
        return true;
      }
    }
    throw new UnauthorizedException('Invalid MES Open API key');
  }
}
