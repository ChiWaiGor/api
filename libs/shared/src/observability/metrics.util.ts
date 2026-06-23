import { Counter, Histogram, UpDownCounter, metrics } from '@opentelemetry/api';
import type { RedisCircuitState } from '../redis/redis-circuit-breaker';
import { isMetricsEnabled } from './otel.util';

const HTTP_METER = 'http';
const AUTH_METER = 'auth';
const INFRA_METER = 'infra';
const WORKER_METER = 'worker';

let httpRequestsTotal: Counter | undefined;
let httpRequestDuration: Histogram | undefined;
let authLoginAttempts: Counter | undefined;
let authRefreshTotal: Counter | undefined;
let authAccountLockouts: Counter | undefined;
let authPasswordResetRequests: Counter | undefined;
let throttleRejections: Counter | undefined;
let redisOperationErrors: Counter | undefined;
let redisCircuitBreakerState: UpDownCounter | undefined;
let mailJobsProcessed: Counter | undefined;
let mailJobDuration: Histogram | undefined;

function getMeter(name: string) {
  return metrics.getMeter(name);
}

function getHttpRequestsTotal(): Counter | undefined {
  if (!isMetricsEnabled()) {
    return undefined;
  }
  httpRequestsTotal ??= getMeter(HTTP_METER).createCounter(
    'http_requests_total',
    { description: 'Total HTTP requests' },
  );
  return httpRequestsTotal;
}

function getHttpRequestDuration(): Histogram | undefined {
  if (!isMetricsEnabled()) {
    return undefined;
  }
  httpRequestDuration ??= getMeter(HTTP_METER).createHistogram(
    'http_request_duration_seconds',
    {
      description: 'HTTP request duration in seconds',
      unit: 's',
    },
  );
  return httpRequestDuration;
}

const CIRCUIT_STATE_VALUE: Record<RedisCircuitState, number> = {
  closed: 0,
  open: 1,
  'half-open': 2,
};

export function normalizeHttpRoute(path: string): string {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/c[a-z0-9]{24}(?=\/|$)/gi, '/:id')
    .replace(/\b[0-9a-f]{24,}\b/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number,
): void {
  const labels = {
    method: method.toUpperCase(),
    route: normalizeHttpRoute(route),
    status: String(statusCode),
  };
  getHttpRequestsTotal()?.add(1, labels);
  getHttpRequestDuration()?.record(durationMs / 1000, labels);

  if (statusCode === 429) {
    recordThrottleRejection('default');
  }
}

export type LoginAttemptResult =
  | 'success'
  | 'invalid_credentials'
  | 'locked'
  | 'inactive';

export function recordLoginAttempt(result: LoginAttemptResult): void {
  if (!isMetricsEnabled()) {
    return;
  }
  authLoginAttempts ??= getMeter(AUTH_METER).createCounter(
    'auth_login_attempts_total',
    { description: 'Login attempts by result' },
  );
  authLoginAttempts.add(1, { result });
}

export type RefreshResult = 'success' | 'invalid' | 'reuse_detected';

export function recordRefreshAttempt(result: RefreshResult): void {
  if (!isMetricsEnabled()) {
    return;
  }
  authRefreshTotal ??= getMeter(AUTH_METER).createCounter(
    'auth_refresh_total',
    { description: 'Refresh token attempts by result' },
  );
  authRefreshTotal.add(1, { result });
}

export function recordAccountLockout(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  authAccountLockouts ??= getMeter(AUTH_METER).createCounter(
    'auth_account_lockouts_total',
    { description: 'Accounts locked after failed logins' },
  );
  authAccountLockouts.add(1);
}

export function recordPasswordResetRequest(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  authPasswordResetRequests ??= getMeter(AUTH_METER).createCounter(
    'auth_password_reset_requests_total',
    { description: 'Password reset requests' },
  );
  authPasswordResetRequests.add(1);
}

export function recordThrottleRejection(throttler: string): void {
  if (!isMetricsEnabled()) {
    return;
  }
  throttleRejections ??= getMeter(INFRA_METER).createCounter(
    'throttle_rejections_total',
    { description: 'Requests rejected by rate limiting' },
  );
  throttleRejections.add(1, { throttler });
}

export function recordRedisOperationError(): void {
  if (!isMetricsEnabled()) {
    return;
  }
  redisOperationErrors ??= getMeter(INFRA_METER).createCounter(
    'redis_operation_errors_total',
    { description: 'Redis operation failures' },
  );
  redisOperationErrors.add(1);
}

let lastCircuitState: RedisCircuitState | undefined;

export function recordRedisCircuitState(state: RedisCircuitState): void {
  if (!isMetricsEnabled()) {
    return;
  }
  redisCircuitBreakerState ??= getMeter(INFRA_METER).createUpDownCounter(
    'redis_circuit_breaker_state',
    {
      description:
        'Redis circuit breaker state (0=closed, 1=open, 2=half-open)',
    },
  );

  if (lastCircuitState === state) {
    return;
  }

  if (lastCircuitState !== undefined) {
    redisCircuitBreakerState.add(-CIRCUIT_STATE_VALUE[lastCircuitState]);
  }
  redisCircuitBreakerState.add(CIRCUIT_STATE_VALUE[state]);
  lastCircuitState = state;
}

export type MailJobResult = 'success' | 'failure';

export function recordMailJob(result: MailJobResult, durationMs: number): void {
  if (!isMetricsEnabled()) {
    return;
  }
  mailJobsProcessed ??= getMeter(WORKER_METER).createCounter(
    'mail_jobs_processed_total',
    { description: 'Mail jobs processed by result' },
  );
  mailJobDuration ??= getMeter(WORKER_METER).createHistogram(
    'mail_job_duration_seconds',
    {
      description: 'Mail job processing duration in seconds',
      unit: 's',
    },
  );
  mailJobsProcessed.add(1, { result });
  mailJobDuration.record(durationMs / 1000, { result });
}

/** Reset circuit-state tracking between tests. */
export function resetMetricsStateForTests(): void {
  lastCircuitState = undefined;
}
