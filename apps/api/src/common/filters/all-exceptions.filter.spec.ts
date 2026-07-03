import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { Env, captureSentryException } from '@app/shared';
import { API_ERROR_CODES } from './api-error.util';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('@app/shared', () => ({
  ...jest.requireActual('@app/shared'),
  captureSentryException: jest.fn(),
}));

describe('AllExceptionsFilter', () => {
  const captureMock = captureSentryException as jest.MockedFunction<
    typeof captureSentryException
  >;

  const createHost = (url = '/test', requestId?: string) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          url,
          method: 'GET',
          headers: requestId ? { 'x-request-id': requestId } : {},
          user: { sub: 'user-1' },
        }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  const createFilter = (nodeEnv: 'development' | 'production' | 'test') =>
    new AllExceptionsFilter({
      get: jest.fn().mockReturnValue(nodeEnv),
    } as unknown as ConfigService<Env, true>);

  beforeEach(() => {
    captureMock.mockClear();
  });

  it('reports unexpected errors to Sentry with request context', () => {
    const filter = createFilter('development');
    const error = new Error('Database exploded');
    const { host, status, json } = createHost('/users', 'req-123');

    filter.catch(error, host);

    expect(captureMock).toHaveBeenCalledWith(error, {
      requestId: 'req-123',
      userId: 'user-1',
      path: '/users',
      method: 'GET',
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Database exploded',
        path: '/users',
        requestId: 'req-123',
      }),
    );
  });

  it('hides internal error details in production', () => {
    const filter = createFilter('production');
    const error = new Error('Secret internals');
    const { host, json } = createHost();

    filter.catch(error, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      }),
    );
  });

  it('delegates HttpException to HttpExceptionFilter', () => {
    const filter = createFilter('development');
    const exception = new BadRequestException('Bad input');
    const { host, status, json } = createHost('/bad');

    filter.catch(exception, host);

    expect(captureMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        code: API_ERROR_CODES.BAD_REQUEST,
        message: 'Bad input',
        path: '/bad',
      }),
    );
  });

  it('delegates ZodValidationException to ZodValidationExceptionFilter', () => {
    const filter = createFilter('development');
    const zodError = new ZodError([
      { code: 'custom', message: 'Invalid email', path: ['email'] },
    ]);
    const exception = new ZodValidationException(zodError);
    const { host, status, json } = createHost('/auth/register');

    filter.catch(exception, host);

    expect(captureMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: API_ERROR_CODES.VALIDATION_FAILED,
        details: [{ path: 'email', code: 'custom', message: 'Invalid email' }],
      }),
    );
  });

  it('uses generic message for non-Error throwables in development', () => {
    const filter = createFilter('development');
    const throwable = 'string failure';
    const { host, status, json } = createHost('/broken');

    filter.catch(throwable, host);

    expect(captureMock).toHaveBeenCalledWith(throwable, {
      requestId: undefined,
      userId: 'user-1',
      path: '/broken',
      method: 'GET',
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
        path: '/broken',
      }),
    );
  });
});
