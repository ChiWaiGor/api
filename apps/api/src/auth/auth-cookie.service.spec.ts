import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Env } from '@app/shared';
import { AuthCookieService } from './auth-cookie.service';
import {
  AUTH_COOKIE_NAMES,
  CSRF_HEADER,
} from './constants/auth-cookies.constants';

const createService = (overrides: Record<string, unknown> = {}) =>
  new AuthCookieService({
    get: (key: string) => {
      const config: Record<string, unknown> = {
        AUTH_COOKIE_SECURE: false,
        AUTH_COOKIE_SAME_SITE: 'lax',
        AUTH_COOKIE_DOMAIN: undefined,
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        ...overrides,
      };
      return config[key];
    },
  } as unknown as ConfigService<Env, true>);

describe('AuthCookieService', () => {
  let service: AuthCookieService;
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(() => {
    service = createService();
    jest.clearAllMocks();
  });

  describe('setAuthCookies', () => {
    it('sets access, refresh, and csrf cookies', () => {
      service.setAuthCookies(res, {
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      expect(res.cookie).toHaveBeenCalledTimes(3);
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.accessToken,
        'access',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          path: '/',
          maxAge: 15 * 60_000,
        }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.refreshToken,
        'refresh',
        expect.objectContaining({
          httpOnly: true,
          maxAge: 7 * 86_400_000,
        }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.csrfToken,
        expect.any(String),
        expect.objectContaining({ httpOnly: false }),
      );
    });

    it('omits the domain attribute when no domain is configured', () => {
      service.setAuthCookies(res, {
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      const [, , options] = (res.cookie as jest.Mock).mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(options).not.toHaveProperty('domain');
    });

    it('includes secure, sameSite, and domain from config', () => {
      service = createService({
        AUTH_COOKIE_SECURE: true,
        AUTH_COOKIE_SAME_SITE: 'none',
        AUTH_COOKIE_DOMAIN: 'example.com',
      });

      service.setAuthCookies(res, {
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.accessToken,
        'access',
        expect.objectContaining({
          secure: true,
          sameSite: 'none',
          domain: 'example.com',
        }),
      );
    });

    it('generates a unique csrf token per call', () => {
      service.setAuthCookies(res, { accessToken: 'a', refreshToken: 'r' });
      service.setAuthCookies(res, { accessToken: 'a', refreshToken: 'r' });

      const csrfCalls = (res.cookie as jest.Mock).mock.calls.filter(
        (call) => call[0] === AUTH_COOKIE_NAMES.csrfToken,
      );
      expect(csrfCalls).toHaveLength(2);
      expect(csrfCalls[0][1]).not.toBe(csrfCalls[1][1]);
    });
  });

  describe('clearAuthCookies', () => {
    it('clears all auth cookies with the shared options', () => {
      service.clearAuthCookies(res);

      expect(res.clearCookie).toHaveBeenCalledTimes(3);
      for (const name of Object.values(AUTH_COOKIE_NAMES)) {
        expect(res.clearCookie).toHaveBeenCalledWith(
          name,
          expect.objectContaining({
            path: '/',
            secure: false,
            sameSite: 'lax',
          }),
        );
      }
    });

    it('clears cookies with the configured domain', () => {
      service = createService({ AUTH_COOKIE_DOMAIN: 'example.com' });
      service.clearAuthCookies(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.accessToken,
        expect.objectContaining({ domain: 'example.com' }),
      );
    });
  });

  describe('getRefreshToken', () => {
    it('reads refresh token from cookies', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.refreshToken]: 'refresh' },
      } as unknown as Request;
      expect(service.getRefreshToken(req)).toBe('refresh');
    });

    it('returns undefined when the cookie is empty', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.refreshToken]: '' },
      } as unknown as Request;
      expect(service.getRefreshToken(req)).toBeUndefined();
    });

    it('returns undefined when no cookies are present', () => {
      const req = {} as Request;
      expect(service.getRefreshToken(req)).toBeUndefined();
    });
  });

  describe('hasAuthCookies', () => {
    it('returns true when an access token cookie exists', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.accessToken]: 'token' },
      } as unknown as Request;
      expect(service.hasAuthCookies(req)).toBe(true);
    });

    it('returns true when only a refresh token cookie exists', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.refreshToken]: 'token' },
      } as unknown as Request;
      expect(service.hasAuthCookies(req)).toBe(true);
    });

    it('returns false when no auth cookies exist', () => {
      const req = { cookies: {} } as unknown as Request;
      expect(service.hasAuthCookies(req)).toBe(false);
    });
  });

  describe('hasBearerAuth', () => {
    it('detects a bearer auth header', () => {
      const req = {
        headers: { authorization: 'Bearer token' },
      } as Request;
      expect(service.hasBearerAuth(req)).toBe(true);
    });

    it('is case-insensitive on the scheme', () => {
      const req = {
        headers: { authorization: 'bearer token' },
      } as Request;
      expect(service.hasBearerAuth(req)).toBe(true);
    });

    it('returns false for non-bearer or missing headers', () => {
      expect(
        service.hasBearerAuth({
          headers: { authorization: 'Basic abc' },
        } as Request),
      ).toBe(false);
      expect(service.hasBearerAuth({ headers: {} } as Request)).toBe(false);
    });
  });

  describe('isCsrfValid', () => {
    it('validates matching CSRF header and cookie', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.csrfToken]: 'csrf-abc' },
        headers: { [CSRF_HEADER]: 'csrf-abc' },
      } as unknown as Request;
      expect(service.isCsrfValid(req)).toBe(true);
    });

    it('rejects mismatched CSRF tokens', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.csrfToken]: 'csrf-abc' },
        headers: { [CSRF_HEADER]: 'wrong' },
      } as unknown as Request;
      expect(service.isCsrfValid(req)).toBe(false);
    });

    it('rejects when the CSRF cookie is missing', () => {
      const req = {
        cookies: {},
        headers: { [CSRF_HEADER]: 'csrf-abc' },
      } as unknown as Request;
      expect(service.isCsrfValid(req)).toBe(false);
    });

    it('rejects when the CSRF header is missing', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.csrfToken]: 'csrf-abc' },
        headers: {},
      } as unknown as Request;
      expect(service.isCsrfValid(req)).toBe(false);
    });

    it('rejects when tokens are present but empty', () => {
      const req = {
        cookies: { [AUTH_COOKIE_NAMES.csrfToken]: '' },
        headers: { [CSRF_HEADER]: '' },
      } as unknown as Request;
      expect(service.isCsrfValid(req)).toBe(false);
    });
  });

  describe('cookie max-age (ttl parsing)', () => {
    it.each([
      ['30s', 30 * 1_000],
      ['15m', 15 * 60_000],
      ['2h', 2 * 3_600_000],
      ['7d', 7 * 86_400_000],
    ])('parses %s into the correct maxAge', (ttl, expected) => {
      service = createService({ JWT_ACCESS_TTL: ttl });
      service.setAuthCookies(res, { accessToken: 'a', refreshToken: 'r' });

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.accessToken,
        'a',
        expect.objectContaining({ maxAge: expected }),
      );
    });

    it('falls back to 15 minutes for an unparseable TTL', () => {
      service = createService({ JWT_ACCESS_TTL: 'not-a-ttl' });
      service.setAuthCookies(res, { accessToken: 'a', refreshToken: 'r' });

      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAMES.accessToken,
        'a',
        expect.objectContaining({ maxAge: 900_000 }),
      );
    });
  });
});
