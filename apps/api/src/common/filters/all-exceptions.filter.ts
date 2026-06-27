import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, type Request } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { Env, captureSentryException } from '@app/shared';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';
import {
  API_ERROR_CODES,
  buildApiErrorBody,
  getRequestId,
  getRequestPath,
} from './api-error.util';
import { HttpExceptionFilter } from './http-exception.filter';
import { ZodValidationExceptionFilter } from './zod-validation-exception.filter';

type RequestWithUser = Request & {
  user?: JwtPayload;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly httpExceptionFilter = new HttpExceptionFilter();
  private readonly zodValidationExceptionFilter =
    new ZodValidationExceptionFilter();

  constructor(private readonly config: ConfigService<Env, true>) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof ZodValidationException) {
      return this.zodValidationExceptionFilter.catch(exception, host);
    }

    if (exception instanceof HttpException) {
      return this.httpExceptionFilter.catch(exception, host);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithUser>();
    const path = getRequestPath(request);
    const requestId = getRequestId(request);

    captureSentryException(exception, {
      requestId,
      userId: request.user?.sub,
      path,
      method: request.method,
    });

    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    const message =
      isProduction || !(exception instanceof Error)
        ? 'Internal server error'
        : exception.message;

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      buildApiErrorBody({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message,
        path,
        requestId,
      }),
    );
  }
}
