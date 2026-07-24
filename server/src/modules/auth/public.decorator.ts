import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** 标记无需登录的接口（如 /api/auth/login、/mock-u8/*） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
