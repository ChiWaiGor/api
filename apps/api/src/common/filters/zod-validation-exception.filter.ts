import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response, type Request } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import {
  API_ERROR_CODES,
  buildApiErrorBody,
  getRequestId,
  getRequestPath,
  mapZodIssuesToDetails,
} from './api-error.util';

@Catch(ZodValidationException)
export class ZodValidationExceptionFilter implements ExceptionFilter {
  catch(exception: ZodValidationException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const zodError = exception.getZodError();
    const details =
      zodError instanceof ZodError
        ? mapZodIssuesToDetails(zodError.issues)
        : [{ message: 'Validation failed' }];

    response.status(HttpStatus.BAD_REQUEST).json(
      buildApiErrorBody({
        statusCode: HttpStatus.BAD_REQUEST,
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Validation failed',
        path: getRequestPath(request),
        details,
        requestId: getRequestId(request),
      }),
    );
  }
}
