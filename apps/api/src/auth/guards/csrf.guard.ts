import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthCookieService } from '../auth-cookie.service';
import { CSRF_EXEMPT_KEY } from '../decorators/csrf-exempt.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection for cookie-authenticated requests.
 * Skipped when the client uses Bearer tokens (mobile/native apps).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authCookies: AuthCookieService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(req.method)) {
      return true;
    }

    const isExempt = this.reflector.getAllAndOverride<boolean>(
      CSRF_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isExempt) {
      return true;
    }

    // Mobile/native clients authenticate via Authorization header — not CSRF-vulnerable.
    if (this.authCookies.hasBearerAuth(req)) {
      return true;
    }

    if (!this.authCookies.hasAuthCookies(req)) {
      return true;
    }

    if (!this.authCookies.isCsrfValid(req)) {
      throw new ForbiddenException('Invalid or missing CSRF token');
    }

    return true;
  }
}
