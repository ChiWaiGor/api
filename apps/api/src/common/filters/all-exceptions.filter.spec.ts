import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env, captureSentryException } from '@app/shared';
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
        message: 'Database exploded',
        path: '/users',
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
        message: 'Internal server error',
      }),
    );
  });
});
