import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { ZodValidationExceptionFilter } from './zod-validation-exception.filter';

describe('ZodValidationExceptionFilter', () => {
  const filter = new ZodValidationExceptionFilter();

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

  it('formats ZodError issues as 400 response', () => {
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
        message: 'Validation failed',
        errors: zodError.issues,
        path: '/auth/register',
      }),
    );
  });
});
