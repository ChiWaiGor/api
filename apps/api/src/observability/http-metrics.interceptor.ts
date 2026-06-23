import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { recordHttpRequest } from '@app/shared';
import { ThrottlerException } from '@nestjs/throttler';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        this.record(request, response.statusCode, startedAt);
      }),
      catchError((error: unknown) => {
        const status =
          error instanceof ThrottlerException
            ? 429
            : typeof error === 'object' &&
                error !== null &&
                'status' in error &&
                typeof error.status === 'number'
              ? (error as { status: number }).status
              : 500;
        this.record(request, status, startedAt);
        return throwError(() => error);
      }),
    );
  }

  private record(
    request: Request,
    statusCode: number,
    startedAt: number,
  ): void {
    const route =
      (request.route as { path?: string } | undefined)?.path ?? request.path;
    recordHttpRequest(
      request.method,
      route,
      statusCode,
      Date.now() - startedAt,
    );
  }
}
