import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, defer, from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { IdempotencyService } from './idempotency.service';
import { idempotencyActorContext } from './idempotency-context';

export const IDEMPOTENT_KEY = 'idempotent:businessKey';

/**
 * @Idempotent('offline.sync') —— 标记接口幂等。
 * 以请求头 X-Request-Id + 业务键去重。离线重放可只传稳定的 X-Task-No，
 * 拦截器会将其归一化为 X-Request-Id，保证跨重连重复提交安全。
 */
export const Idempotent = (businessKey?: string) =>
  SetMetadata(IDEMPOTENT_KEY, businessKey ?? '');

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idem: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const warehouseScope = req.user?.allWarehouseAccess
      ? '*'
      : [...(req.user?.warehouseCodes ?? [])].sort().join(',');
    const actorKey = req.user?.id
      ? `${req.user.id}|warehouses=${warehouseScope}`
      : 'anonymous';
    return defer(() =>
      idempotencyActorContext.run(actorKey, () => {
        const meta = this.reflector.get<string>(
          IDEMPOTENT_KEY,
          context.getHandler(),
        );
        if (meta === undefined) return next.handle();

        const requestId = (req.headers['x-request-id'] ??
          req.headers['x-task-no']) as string;
        if (!requestId) return next.handle();
        if (!req.headers['x-request-id']) {
          req.headers['x-request-id'] = requestId;
        }
        const businessKey =
          meta || `${req.method} ${req.route?.path ?? req.url}`;

        return from(this.idem.findStored(requestId, businessKey)).pipe(
          mergeMap((stored) => {
            if (stored !== undefined) return of(stored);
            return next.handle().pipe(
              mergeMap((data) =>
                from(
                  this.idem.execute(requestId, businessKey, async () => data),
                ),
              ),
            );
          }),
        );
      }),
    );
  }
}
