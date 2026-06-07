import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL = 'requireVerifiedEmail';

/**
 * Gate a route behind a verified email address. Apply to sensitive actions
 * (e.g. privileged mutations) on top of the usual auth/permission guards.
 * Routes without this decorator are unaffected.
 */
export const RequireVerifiedEmail = () =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL, true);
