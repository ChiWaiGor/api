import type { Request } from 'express';
import { AUTH_COOKIE_NAMES } from '../constants/auth-cookies.constants';
import { extractAccessToken } from './jwt-cookie-extractor';

describe('extractAccessToken', () => {
  const createRequest = (overrides: Partial<Request> = {}): Request =>
    ({
      headers: {},
      cookies: {},
      ...overrides,
    }) as Request;

  it('returns Bearer token when Authorization header is present', () => {
    const req = createRequest({
      headers: { authorization: 'Bearer header-token' },
      cookies: { [AUTH_COOKIE_NAMES.accessToken]: 'cookie-token' },
    });

    expect(extractAccessToken(req)).toBe('header-token');
  });

  it('returns access_token cookie when Bearer header is absent', () => {
    const req = createRequest({
      cookies: { [AUTH_COOKIE_NAMES.accessToken]: 'cookie-token' },
    });

    expect(extractAccessToken(req)).toBe('cookie-token');
  });

  it('falls back to cookie when Authorization header is not Bearer', () => {
    const req = createRequest({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      cookies: { [AUTH_COOKIE_NAMES.accessToken]: 'cookie-token' },
    });

    expect(extractAccessToken(req)).toBe('cookie-token');
  });

  it('returns null when neither Bearer nor cookie token is present', () => {
    expect(extractAccessToken(createRequest())).toBeNull();
  });

  it('returns null for empty cookie token', () => {
    const req = createRequest({
      cookies: { [AUTH_COOKIE_NAMES.accessToken]: '' },
    });

    expect(extractAccessToken(req)).toBeNull();
  });

  it('returns null when cookies are undefined', () => {
    const req = createRequest({ cookies: undefined });

    expect(extractAccessToken(req)).toBeNull();
  });
});
