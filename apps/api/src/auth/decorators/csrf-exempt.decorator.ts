import { SetMetadata } from '@nestjs/common';

export const CSRF_EXEMPT_KEY = 'csrfExempt';

/** Skip CSRF validation (e.g. login/register where no session exists yet). */
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT_KEY, true);
