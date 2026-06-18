import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';
import { Env } from '../config/env.schema';

export function buildRedisOptions(
  config: ConfigService<Env, true>,
  overrides?: Partial<RedisOptions>,
): RedisOptions {
  const password = config.get('REDIS_PASSWORD', { infer: true });
  const tls = config.get('REDIS_TLS', { infer: true });

  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
    password: password || undefined,
    db: config.get('REDIS_DB', { infer: true }),
    ...(tls ? { tls: {} } : {}),
    ...overrides,
  };
}
