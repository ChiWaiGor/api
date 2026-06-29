import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { AUTH_COOKIE_NAMES } from '../constants/auth-cookies.constants';

/**
 * Extract JWT access token from Authorization: Bearer (mobile) or httpOnly
 * cookie (web). Bearer takes precedence when both are present.
 */
export function extractAccessToken(req: Request): string | null {
  const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (bearer) {
    return bearer;
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  const cookieToken = cookies?.[AUTH_COOKIE_NAMES.accessToken];
  return typeof cookieToken === 'string' && cookieToken.length > 0
    ? cookieToken
    : null;
}
