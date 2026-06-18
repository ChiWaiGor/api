import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { captureSentryException } from '@app/shared';
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

  it('formats string exception responses', () => {
    const exception = new BadRequestException('Bad input');
    const { host, status, json } = createHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Bad input',
        path: '/test',
      }),
    );
  });

  it('formats object exception responses with message array', () => {
    const exception = new BadRequestException({
      message: ['field is required'],
      error: 'Bad Request',
    });
    const { host, json } = createHost();

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['field is required'],
      }),
    );
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
        message: 'Upstream failed',
      }),
    );
  });
});
