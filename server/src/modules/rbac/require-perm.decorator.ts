import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERM_KEY = 'rbac:requirePerm';

/** @RequirePerm('inventory.inbound') —— 声明接口所需权限码 */
export const RequirePerm = (perm: string) => SetMetadata(REQUIRE_PERM_KEY, perm);
