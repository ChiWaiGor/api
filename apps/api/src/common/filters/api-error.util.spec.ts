import { HttpStatus } from '@nestjs/common';
import {
  API_ERROR_CODES,
  buildApiErrorBody,
  getRequestPath,
  isOperationalExemptPath,
  mapZodIssuesToDetails,
  parseHttpExceptionResponse,
  statusToErrorCode,
} from './api-error.util';

describe('api-error.util', () => {
  describe('isOperationalExemptPath', () => {
    it.each([
      '/health',
      '/health/ready',
      '/metrics',
      '/metrics?format=prometheus',
    ])('returns true for %s', (path) => {
      expect(isOperationalExemptPath(path)).toBe(true);
    });

    it.each(['/auth/login', '/users', '/healthcheck'])(
      'returns false for %s',
      (path) => {
        expect(isOperationalExemptPath(path)).toBe(false);
      },
    );
  });

  describe('getRequestPath', () => {
    it('strips query strings', () => {
      expect(getRequestPath({ url: '/users?page=1' } as never)).toBe('/users');
    });
  });

  describe('statusToErrorCode', () => {
    it('maps common HTTP statuses', () => {
      expect(statusToErrorCode(HttpStatus.FORBIDDEN)).toBe(
        API_ERROR_CODES.FORBIDDEN,
      );
      expect(statusToErrorCode(HttpStatus.TOO_MANY_REQUESTS)).toBe(
        API_ERROR_CODES.TOO_MANY_REQUESTS,
      );
      expect(statusToErrorCode(599)).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe('parseHttpExceptionResponse', () => {
    it('handles string responses', () => {
      expect(parseHttpExceptionResponse('Bad input')).toEqual({
        message: 'Bad input',
      });
    });

    it('normalizes message arrays into details', () => {
      expect(
        parseHttpExceptionResponse({
          message: ['field is required'],
          error: 'Bad Request',
        }),
      ).toEqual({
        message: 'Validation failed',
        details: [{ message: 'field is required' }],
      });
    });
  });

  describe('mapZodIssuesToDetails', () => {
    it('maps Zod issues to API error details', () => {
      expect(
        mapZodIssuesToDetails([
          { code: 'custom', message: 'Invalid email', path: ['email'] },
        ] as never),
      ).toEqual([{ path: 'email', code: 'custom', message: 'Invalid email' }]);
    });
  });

  describe('buildApiErrorBody', () => {
    it('omits empty details and optional requestId', () => {
      expect(
        buildApiErrorBody({
          statusCode: 400,
          code: API_ERROR_CODES.BAD_REQUEST,
          message: 'Bad input',
          path: '/users',
        }),
      ).toEqual({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Bad input',
        timestamp: expect.any(String),
        path: '/users',
      });
    });
  });
});
