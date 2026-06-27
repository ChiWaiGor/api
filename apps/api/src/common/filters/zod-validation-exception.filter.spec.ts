import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { API_ERROR_CODES } from './api-error.util';
import { ZodValidationExceptionFilter } from './zod-validation-exception.filter';

describe('ZodValidationExceptionFilter', () => {
  const filter = new ZodValidationExceptionFilter();

  const createHost = (url = '/test') => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          url,
          headers: { 'x-request-id': 'req-1' },
        }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('formats ZodError issues with standardized contract', () => {
    const zodError = new ZodError([
      { code: 'custom', message: 'Invalid email', path: ['email'] },
    ]);
    const exception = new ZodValidationException(zodError);
    const { host, status, json } = createHost('/auth/register');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        code: API_ERROR_CODES.VALIDATION_FAILED,
        message: 'Validation failed',
        details: [{ path: 'email', code: 'custom', message: 'Invalid email' }],
        requestId: 'req-1',
        path: '/auth/register',
        timestamp: expect.any(String),
      }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });
});
