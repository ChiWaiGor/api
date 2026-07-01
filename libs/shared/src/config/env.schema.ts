import { z } from 'zod';
import { parseTrustProxy } from './trust-proxy.util';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    REDIS_HOST: z.string().min(1),
    REDIS_PORT: z.coerce.number().int().positive(),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: z.coerce.number().int().nonnegative().default(0),
    // Enable TLS for managed Redis (ElastiCache in-transit encryption, Upstash,
    // Redis Cloud, etc.). Uses host/port/password/db; set REDIS_TLS=true rather
    // than rediss:// URLs.
    REDIS_TLS: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().min(1),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_TTL: z.string().min(1),
    ARGON2_MEMORY_KB: z.coerce.number().int().positive().default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(4),
    CORS_ORIGINS: z.string().transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
    // Express trust proxy: false (local/direct), hop count (e.g. 1 behind one LB),
    // or comma-separated trusted proxy CIDRs/IPs (e.g. 10.0.0.0/8,172.16.0.0/12).
    TRUST_PROXY: z
      .string()
      .optional()
      .default('false')
      .transform((v, ctx) => {
        try {
          return parseTrustProxy(v);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            message:
              error instanceof Error ? error.message : 'Invalid TRUST_PROXY',
          });
          return z.NEVER;
        }
      }),
    THROTTLE_TTL: z.coerce.number().int().positive(),
    THROTTLE_LIMIT: z.coerce.number().int().positive(),
    THROTTLE_AUTH_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
    PERMISSION_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    SESSION_STATE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    // Brute-force / account-lockout defense. Failed logins are counted in Redis
    // over the rolling window; on reaching the threshold the user is LOCKED.
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    // Single-use auth lifecycle token lifetimes.
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    EMAIL_VERIFICATION_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1440),
    // Base URL used to build links in outbound emails (reset/verification).
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    // Mail provider abstraction. 'log' writes messages to the logger (default,
    // dev/test); 'smtp' sends via nodemailer (Mailpit locally, SES/SendGrid/etc.
    // in production).
    MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    MAIL_FROM: z.string().default('no-reply@example.com'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    SMTP_SECURE: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    // BullMQ job queue settings (shared by API producers and background workers).
    MAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    MAIL_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
    // Optional Redis key prefix for BullMQ queues (useful when sharing Redis).
    QUEUE_PREFIX: z.string().optional().default(''),
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
    // Defaults to off so production never exposes /docs unless explicitly opted
    // in. Local/dev environments enable it via .env (see .env.example).
    SWAGGER_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    // Error tracking (Sentry). Leave SENTRY_DSN unset locally; set in staging/prod.
    SENTRY_DSN: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
    SENTRY_ENVIRONMENT: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
    SENTRY_RELEASE: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
    // OpenTelemetry distributed tracing. Export spans to an OTLP collector
    // (Jaeger, Grafana Tempo, Honeycomb, etc.). Requires OTEL_EXPORTER_OTLP_ENDPOINT.
    OTEL_TRACES_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
    OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.1),
    OTEL_SERVICE_NAME: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
    // Prometheus metrics scrape endpoint (separate HTTP server on METRICS_PORT).
    METRICS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    METRICS_PORT: z.coerce.number().int().positive().default(9464),
    // Browser (web) auth cookies. Mobile/native clients use Bearer tokens instead.
    // AUTH_COOKIE_SECURE defaults to true in production (requires HTTPS).
    AUTH_COOKIE_SECURE: z
      .string()
      .optional()
      .transform((v) => {
        if (v === undefined || v === '') {
          return undefined;
        }
        return v === 'true' || v === '1';
      }),
    AUTH_COOKIE_SAME_SITE: z
      .enum(['strict', 'lax', 'none'])
      .optional()
      .default('lax'),
    AUTH_COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((v) => {
        const trimmed = v?.trim();
        return trimmed ? trimmed : undefined;
      }),
  })
  .transform((env) => ({
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    // In production a wildcard or empty CORS allowlist is unsafe, especially
    // combined with credentialed requests. Require explicit origins.
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list explicit origins in production',
      });
    }
    if (env.CORS_ORIGINS.some((origin) => origin === '*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS cannot be a wildcard (*) in production',
      });
    }
    // Web auth cookies must be Secure in production (HTTPS). Browsers also require
    // Secure when SameSite=None for cross-site credentialed requests.
    if (env.AUTH_COOKIE_SECURE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message:
          'AUTH_COOKIE_SECURE must be true in production (required for HTTPS and SameSite=None cookies)',
      });
    }
    if (env.AUTH_COOKIE_SAME_SITE === 'none' && !env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SAME_SITE'],
        message:
          'AUTH_COOKIE_SAME_SITE cannot be "none" without AUTH_COOKIE_SECURE=true (browser requirement)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const ENV_TOKEN = Symbol('ENV');
