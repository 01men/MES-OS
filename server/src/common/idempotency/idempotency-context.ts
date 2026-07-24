import { AsyncLocalStorage } from 'async_hooks';

/**
 * HTTP 请求内的幂等命名空间。
 * 守卫已认证的用户 ID 与仓库范围指纹会贯穿控制器和服务层，
 * 避免不同用户或范围变更前后的请求共享缓存响应。
 */
export const idempotencyActorContext = new AsyncLocalStorage<string>();

export function scopedBusinessKey(businessKey: string): string {
  const actor = idempotencyActorContext.getStore();
  return actor ? `${businessKey}::actor:${actor}` : businessKey;
}
