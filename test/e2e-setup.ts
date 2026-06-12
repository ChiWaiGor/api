/**
 * E2E runs many auth endpoints in one suite; use a higher auth throttle limit
 * than production so register/login tests are not flaky (default is 10/min).
 */
process.env.THROTTLE_AUTH_LIMIT = '100';
