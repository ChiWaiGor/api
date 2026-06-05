import { z } from 'zod';

export const envSchema = z.object({
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
  PERMISSION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  // Defaults to off so production never exposes /docs unless explicitly opted
  // in. Local/dev environments enable it via .env (see .env.example).
  SWAGGER_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export const ENV_TOKEN = Symbol('ENV');
