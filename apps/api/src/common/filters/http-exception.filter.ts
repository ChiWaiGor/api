import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, type Request } from 'express';
import { captureSentryException } from '@app/shared';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';

type RequestWithUser = Request & {
  user?: JwtPayload;
};

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();
    const statusCode = exception.getStatus();
    if (statusCode >= 500) {
      captureSentryException(exception, {
        requestId: request.headers?.['x-request-id'] as string | undefined,
        userId: request.user?.sub,
        path: request.url,
        method: request.method,
      });
    }

    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as { message?: string | string[] }).message ??
          'Error');

    response.status(statusCode).json({
      statusCode,
      message,
      error: HttpStatus[statusCode] ?? 'Error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
