import { applyDecorators } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

/**
 * Opt into the `auth` named throttler and skip `default` / `auth-refresh`.
 * Use on sensitive auth mutations (login, register, password reset, etc.).
 */
export function AuthThrottle() {
  return applyDecorators(
    SkipThrottle({ default: true, 'auth-refresh': true }),
    Throttle({ auth: {} }),
  );
}

/**
 * Opt into the `auth-refresh` named throttler and skip `default` / `auth`.
 * Use on `POST /auth/refresh` (higher limit than `auth`).
 */
export function AuthRefreshThrottle() {
  return applyDecorators(
    SkipThrottle({ default: true, auth: true }),
    Throttle({ 'auth-refresh': {} }),
  );
}
