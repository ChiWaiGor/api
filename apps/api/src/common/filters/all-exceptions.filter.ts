import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, type Request } from 'express';
import { Env, captureSentryException } from '@app/shared';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';

type RequestWithUser = Request & {
  user?: JwtPayload;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService<Env, true>) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();

    captureSentryException(exception, {
      requestId: request.headers?.['x-request-id'] as string | undefined,
      userId: request.user?.sub,
      path: request.url,
      method: request.method,
    });

    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    const message =
      isProduction || !(exception instanceof Error)
        ? 'Internal server error'
        : exception.message;

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
