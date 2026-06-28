/** httpOnly cookies set for browser (web) clients. */
export const AUTH_COOKIE_NAMES = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  /** Readable by JS for double-submit CSRF validation on cookie-authenticated mutations. */
  csrfToken: 'csrf_token',
} as const;

/** Request header web clients send to opt into cookie-based auth. */
export const AUTH_CLIENT_HEADER = 'x-auth-client';

/** Header that must match the csrf_token cookie on cookie-authenticated mutations. */
export const CSRF_HEADER = 'x-csrf-token';

export type AuthClient = 'web' | 'mobile';
