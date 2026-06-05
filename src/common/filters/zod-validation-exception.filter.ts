import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

@Catch(ZodValidationException)
export class ZodValidationExceptionFilter implements ExceptionFilter {
  catch(exception: ZodValidationException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const zodError = exception.getZodError();
    const issues =
      zodError instanceof ZodError
        ? zodError.issues
        : [{ message: 'Validation failed' }];

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Validation failed',
      errors: issues,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
