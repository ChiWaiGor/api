import { ExecutionContext } from '@nestjs/common';

/**
 * Must stay aligned with `@nestjs/throttler`'s internal metadata key
 * (`THROTTLER_LIMIT` + throttlerName). `@Throttle({ auth: {} })` defines this
 * key even when `limit` is undefined, which is how routes opt into a named
 * throttler.
 */
const THROTTLER_LIMIT_PREFIX = 'THROTTLER:LIMIT';

/** True when the route/class opted in via `@Throttle({ [name]: … })`. */
export function isNamedThrottlerOptedIn(
  context: ExecutionContext,
  throttlerName: string,
): boolean {
  const key = `${THROTTLER_LIMIT_PREFIX}${throttlerName}`;
  return (
    Reflect.hasMetadata(key, context.getHandler()) ||
    Reflect.hasMetadata(key, context.getClass())
  );
}

/**
 * `skipIf` for named throttlers that should not apply globally.
 * Returns true (skip) unless the handler/class opted in with `@Throttle`.
 */
export function skipUnlessNamedThrottlerOptedIn(throttlerName: string) {
  return (context: ExecutionContext): boolean =>
    !isNamedThrottlerOptedIn(context, throttlerName);
}
