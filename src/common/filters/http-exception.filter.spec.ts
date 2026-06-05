import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  const createHost = (url = '/test') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

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
  });
});
