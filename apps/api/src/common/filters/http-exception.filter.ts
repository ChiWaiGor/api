import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response, type Request } from 'express';
import { captureSentryException } from '@app/shared';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';
import {
  buildApiErrorBody,
  getRequestId,
  getRequestPath,
  isOperationalExemptPath,
  parseHttpExceptionResponse,
  statusToErrorCode,
} from './api-error.util';

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
    const path = getRequestPath(request);
    const requestId = getRequestId(request);
    const exempt = isOperationalExemptPath(path);

    if (statusCode >= 500 && !exempt) {
      captureSentryException(exception, {
        requestId,
        userId: request.user?.sub,
        path,
        method: request.method,
      });
    }

    const exceptionResponse = exception.getResponse();

    if (exempt) {
      response
        .status(statusCode)
        .json(
          typeof exceptionResponse === 'string'
            ? { message: exceptionResponse }
            : exceptionResponse,
        );
      return;
    }

    const { message, details } = parseHttpExceptionResponse(exceptionResponse);

    response.status(statusCode).json(
      buildApiErrorBody({
        statusCode,
        code: statusToErrorCode(statusCode),
        message,
        path,
        details,
        requestId,
      }),
    );
  }
}
