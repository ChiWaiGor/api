import { z } from 'zod';

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
    THROTTLE_TTL: z.coerce.number().int().positive(),
    THROTTLE_LIMIT: z.coerce.number().int().positive(),
    THROTTLE_AUTH_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
    PERMISSION_CACHE_TTL_SECONDS: z.coerce
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
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
    // Defaults to off so production never exposes /docs unless explicitly opted
    // in. Local/dev environments enable it via .env (see .env.example).
    SWAGGER_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
  })
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
  });

export type Env = z.infer<typeof envSchema>;

export const ENV_TOKEN = Symbol('ENV');
