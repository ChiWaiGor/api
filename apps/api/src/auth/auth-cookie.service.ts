import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { Env } from '@app/shared';
import {
  AUTH_COOKIE_NAMES,
  CSRF_HEADER,
} from './constants/auth-cookies.constants';

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  setAuthCookies(res: Response, tokens: AuthTokenPair): void {
    const baseOptions = this.baseCookieOptions();
    const csrfToken = randomBytes(32).toString('hex');

    res.cookie(AUTH_COOKIE_NAMES.accessToken, tokens.accessToken, {
      ...baseOptions,
      httpOnly: true,
      maxAge: this.ttlToMs(this.config.get('JWT_ACCESS_TTL', { infer: true })),
    });

    res.cookie(AUTH_COOKIE_NAMES.refreshToken, tokens.refreshToken, {
      ...baseOptions,
      httpOnly: true,
      maxAge: this.ttlToMs(this.config.get('JWT_REFRESH_TTL', { infer: true })),
    });

    // Double-submit CSRF token: readable by the SPA, validated against a header.
    res.cookie(AUTH_COOKIE_NAMES.csrfToken, csrfToken, {
      ...baseOptions,
      httpOnly: false,
      maxAge: this.ttlToMs(this.config.get('JWT_REFRESH_TTL', { infer: true })),
    });
  }

  clearAuthCookies(res: Response): void {
    const clearOptions = this.baseCookieOptions();

    for (const name of Object.values(AUTH_COOKIE_NAMES)) {
      res.clearCookie(name, clearOptions);
    }
  }

  /** Shared cookie attributes (secure/sameSite/domain/path) for set and clear. */
  private baseCookieOptions(): CookieOptions {
    const domain = this.config.get('AUTH_COOKIE_DOMAIN', { infer: true });
    return {
      secure: this.config.get('AUTH_COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('AUTH_COOKIE_SAME_SITE', { infer: true }),
      ...(domain ? { domain } : {}),
      path: '/',
    };
  }

  getRefreshToken(req: Request): string | undefined {
    const token = this.getCookies(req)[AUTH_COOKIE_NAMES.refreshToken];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }

  hasAuthCookies(req: Request): boolean {
    const cookies = this.getCookies(req);
    return Boolean(
      cookies[AUTH_COOKIE_NAMES.accessToken] ||
      cookies[AUTH_COOKIE_NAMES.refreshToken],
    );
  }

  hasBearerAuth(req: Request): boolean {
    const auth = req.headers.authorization;
    return typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ');
  }

  isCsrfValid(req: Request): boolean {
    const cookieToken = this.getCookies(req)[AUTH_COOKIE_NAMES.csrfToken];
    const headerToken = req.headers[CSRF_HEADER];
    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      cookieToken.length === 0 ||
      headerToken.length === 0
    ) {
      return false;
    }
    return cookieToken === headerToken;
  }

  private getCookies(req: Request): Record<string, string> {
    return (req.cookies as Record<string, string> | undefined) ?? {};
  }

  private ttlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 900_000;
    const value = Number(match[1]);
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * (multipliers[match[2]] ?? 60_000);
  }
}
