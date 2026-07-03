import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { of, throwError } from 'rxjs';
import { recordHttpRequest } from '@app/shared';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

jest.mock('@app/shared', () => ({
  recordHttpRequest: jest.fn(),
}));

describe('HttpMetricsInterceptor', () => {
  const recordMock = recordHttpRequest as jest.MockedFunction<
    typeof recordHttpRequest
  >;

  const createContext = (
    method = 'GET',
    path = '/health',
    routePath = path,
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          path,
          route: { path: routePath },
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    }) as ExecutionContext;

  beforeEach(() => {
    recordMock.mockClear();
  });

  it('records successful HTTP responses', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const next: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(createContext(), next).subscribe({
      complete: () => {
        expect(recordMock).toHaveBeenCalledWith(
          'GET',
          '/health',
          200,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records error responses including throttling', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const next: CallHandler = {
      handle: () => throwError(() => new ThrottlerException()),
    };

    interceptor
      .intercept(createContext('POST', '/auth/login', '/auth/login'), next)
      .subscribe({
        error: () => {
          expect(recordMock).toHaveBeenCalledWith(
            'POST',
            '/auth/login',
            429,
            expect.any(Number),
          );
          done();
        },
      });
  });

  it('records HTTP errors with an explicit status property', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const next: CallHandler = {
      handle: () => throwError(() => ({ status: 404 })),
    };

    interceptor
      .intercept(createContext('GET', '/missing', '/missing'), next)
      .subscribe({
        error: () => {
          expect(recordMock).toHaveBeenCalledWith(
            'GET',
            '/missing',
            404,
            expect.any(Number),
          );
          done();
        },
      });
  });

  it('defaults unknown errors to status 500', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    interceptor.intercept(createContext(), next).subscribe({
      error: () => {
        expect(recordMock).toHaveBeenCalledWith(
          'GET',
          '/health',
          500,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('falls back to request.path when route.path is missing', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path: '/fallback',
          route: undefined,
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as ExecutionContext;
    const next: CallHandler = { handle: () => of({ ok: true }) };

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(recordMock).toHaveBeenCalledWith(
          'GET',
          '/fallback',
          200,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('passes through non-http contexts', (done) => {
    const interceptor = new HttpMetricsInterceptor();
    const context = {
      getType: () => 'rpc',
    } as ExecutionContext;
    const next: CallHandler = { handle: () => of(true) };

    interceptor.intercept(context, next).subscribe({
      next: (value) => {
        expect(value).toBe(true);
        expect(recordMock).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
