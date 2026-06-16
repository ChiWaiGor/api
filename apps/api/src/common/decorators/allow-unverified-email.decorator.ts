import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_EMAIL_KEY = 'allowUnverifiedEmail';

/**
 * Opt out of the global verified-email requirement for authenticated routes
 * (e.g. profile, resend verification, logout). Does not bypass JWT auth.
 */
export const AllowUnverifiedEmail = () =>
  SetMetadata(ALLOW_UNVERIFIED_EMAIL_KEY, true);
