import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

/** 业务异常：统一 { code, message, requestId } 响应 */
export class BizException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
    this.name = 'BizException';
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof BizException) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : (body as any)?.message ?? exception.message;
      code =
        status === HttpStatus.FORBIDDEN
          ? 'FORBIDDEN'
          : status === HttpStatus.UNAUTHORIZED
            ? 'UNAUTHORIZED'
            : 'HTTP_ERROR';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    res.status(status).json({ code, message, requestId });
  }
}
