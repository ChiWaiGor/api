import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { captureSentryException } from '@app/shared';
import { API_ERROR_CODES } from './api-error.util';
import { HttpExceptionFilter } from './http-exception.filter';

jest.mock('@app/shared', () => ({
  ...jest.requireActual('@app/shared'),
  captureSentryException: jest.fn(),
}));

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  const captureMock = captureSentryException as jest.MockedFunction<
    typeof captureSentryException
  >;

  const createHost = (url = '/test') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          url,
          method: 'POST',
          headers: { 'x-request-id': 'req-1' },
          user: { sub: 'user-1' },
        }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  beforeEach(() => {
    captureMock.mockClear();
  });

  it('formats string exception responses with standardized contract', () => {
    const exception = new BadRequestException('Bad input');
    const { host, status, json } = createHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        code: API_ERROR_CODES.BAD_REQUEST,
        message: 'Bad input',
        path: '/test',
        requestId: 'req-1',
        timestamp: expect.any(String),
      }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('error');
  });

  it('normalizes object exception responses with message arrays into details', () => {
    const exception = new BadRequestException({
      message: ['field is required'],
      error: 'Bad Request',
    });
    const { host, json } = createHost();

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: API_ERROR_CODES.BAD_REQUEST,
        message: 'Validation failed',
        details: [{ message: 'field is required' }],
      }),
    );
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('passes through Terminus health-check bodies on operational paths', () => {
    const healthBody = {
      status: 'error',
      info: { database: { status: 'up' } },
      error: {
        redis: { status: 'down', message: 'Could not connect' },
      },
      details: {
        database: { status: 'up' },
        redis: { status: 'down', message: 'Could not connect' },
      },
    };
    const exception = new ServiceUnavailableException(healthBody);
    const { host, status, json } = createHost('/health/ready');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(healthBody);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('reports server errors to Sentry', () => {
    const exception = new InternalServerErrorException('Upstream failed');
    const { host, status, json } = createHost('/broken');

    filter.catch(exception, host);

    expect(captureMock).toHaveBeenCalledWith(exception, {
      requestId: 'req-1',
      userId: 'user-1',
      path: '/broken',
      method: 'POST',
    });
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: 'Upstream failed',
      }),
    );
  });

  it('passes through operational paths with string exception bodies', () => {
    const exception = new HttpException(
      'Redis unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    const { host, status, json } = createHost('/metrics');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({ message: 'Redis unavailable' });
    expect(captureMock).not.toHaveBeenCalled();
  });
});
