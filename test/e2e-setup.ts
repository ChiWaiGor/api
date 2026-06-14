import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';

// Jest does not load .env; read it here before AppModule / ConfigModule boot.
const root = resolve(__dirname, '..');
loadEnv({ path: resolve(root, '.env') });
const localEnv = resolve(root, '.env.local');
if (existsSync(localEnv)) {
  loadEnv({ path: localEnv, override: true });
}

/**
 * E2E runs many auth endpoints in one suite; use a higher auth throttle limit
 * than production so register/login tests are not flaky (default is 10/min).
 */
process.env.THROTTLE_AUTH_LIMIT = '100';

process.env.MAIL_TRANSPORT = 'log';

// E2E isolation when POSTGRES_E2E_DB is set (local and CI).
if (process.env.POSTGRES_E2E_DB) {
  process.env.REDIS_DB = process.env.REDIS_E2E_DB ?? '15';

  const user = process.env.POSTGRES_USER ?? 'app';
  const pass = process.env.POSTGRES_PASSWORD ?? 'app';
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  process.env.DATABASE_URL = `postgresql://${user}:${pass}@${host}:${port}/${process.env.POSTGRES_E2E_DB}?schema=public`;
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run e2e with NODE_ENV=production');
}
