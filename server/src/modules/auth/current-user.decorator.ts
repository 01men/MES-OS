import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id: number;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
}

/** @CurrentUser() 取当前登录用户；@CurrentUser('username') 取单字段 */
export const CurrentUser = createParamDecorator(
  (field: keyof CurrentUserPayload | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as CurrentUserPayload;
    return field ? user?.[field] : user;
  },
);
