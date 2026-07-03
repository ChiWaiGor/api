import type { Request } from 'express';
import { AUTH_CLIENT_HEADER } from '../constants/auth-cookies.constants';
import { getAuthClient, isWebAuthClient } from './auth-client.util';

describe('auth-client.util', () => {
  const createRequest = (header?: string): Request =>
    ({
      headers: header === undefined ? {} : { [AUTH_CLIENT_HEADER]: header },
    }) as Request;

  it('returns web when X-Auth-Client is web (case-insensitive)', () => {
    expect(getAuthClient(createRequest('web'))).toBe('web');
    expect(getAuthClient(createRequest('WEB'))).toBe('web');
    expect(isWebAuthClient(createRequest('Web'))).toBe(true);
  });

  it('returns mobile when header is absent or not web', () => {
    expect(getAuthClient(createRequest())).toBe('mobile');
    expect(getAuthClient(createRequest('mobile'))).toBe('mobile');
    expect(isWebAuthClient(createRequest('mobile'))).toBe(false);
  });

  it('returns mobile when header is an empty string', () => {
    expect(getAuthClient(createRequest(''))).toBe('mobile');
    expect(isWebAuthClient(createRequest(''))).toBe(false);
  });

  it('returns mobile when header is not a string', () => {
    const req = {
      headers: { [AUTH_CLIENT_HEADER]: ['web'] },
    } as unknown as Request;

    expect(getAuthClient(req)).toBe('mobile');
  });
});
