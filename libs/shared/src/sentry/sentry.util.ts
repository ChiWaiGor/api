import * as Sentry from '@sentry/nestjs';

export type SentryServiceName = 'api' | 'worker';

export interface SentryRequestContext {
  requestId?: string;
  userId?: string;
  path?: string;
  method?: string;
}

export interface SentryJobContext {
  queue: string;
  jobName: string;
  jobId?: string;
}

const SENSITIVE_KEY_PATTERN =
  /password|token|authorization|cookie|secret|api[_-]?key/i;

function scrubSensitiveData(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(scrubSensitiveData);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      scrubbed[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[Filtered]'
        : scrubSensitiveData(nested);
    }
    return scrubbed;
  }
  return value;
}

function parseTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0;
  }
  return parsed;
}

/** Returns true when Sentry was initialized for this process. */
export function initSentry(service: SentryServiceName): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return false;
  }

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT?.trim() ||
      process.env.NODE_ENV ||
      'development',
    release: process.env.SENTRY_RELEASE?.trim() || undefined,
    tracesSampleRate: parseTracesSampleRate(),
    beforeSend(event) {
      if (event.request?.headers) {
        event.request.headers = scrubSensitiveData(
          event.request.headers,
        ) as Record<string, string>;
      }
      if (event.request?.data) {
        event.request.data = scrubSensitiveData(event.request.data);
      }
      return event;
    },
  });

  Sentry.setTag('service', service);
  return true;
}

export function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN?.trim());
}

export function captureSentryException(
  exception: unknown,
  context?: SentryRequestContext | SentryJobContext,
): void {
  if (!isSentryEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context && 'queue' in context) {
      scope.setTag('queue', context.queue);
      scope.setTag('jobName', context.jobName);
      if (context.jobId) {
        scope.setTag('jobId', context.jobId);
      }
      scope.setContext('job', { ...context });
    } else if (context) {
      if (context.requestId) {
        scope.setTag('requestId', context.requestId);
      }
      if (context.path) {
        scope.setTag('path', context.path);
      }
      if (context.method) {
        scope.setTag('method', context.method);
      }
      if (context.userId) {
        scope.setUser({ id: context.userId });
      }
    }

    Sentry.captureException(exception);
  });
}
