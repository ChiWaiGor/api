import { envSchema } from './env.schema';

/** Minimal env input that satisfies required fields for production validation tests. */
function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app?schema=public',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_REFRESH_TTL: '7d',
    CORS_ORIGINS: 'https://app.example.com',
    APP_BASE_URL: 'https://app.example.com',
    MAIL_TRANSPORT: 'smtp',
    THROTTLE_TTL: '60000',
    THROTTLE_LIMIT: '100',
    ...overrides,
  };
}

describe('envSchema production cookie validation', () => {
  it('defaults AUTH_COOKIE_SECURE to true in production when unset', () => {
    const result = envSchema.safeParse(productionEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_COOKIE_SECURE).toBe(true);
    }
  });

  it('accepts explicit AUTH_COOKIE_SECURE=true in production', () => {
    const result = envSchema.safeParse(
      productionEnv({ AUTH_COOKIE_SECURE: 'true' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects AUTH_COOKIE_SECURE=false in production', () => {
    const result = envSchema.safeParse(
      productionEnv({ AUTH_COOKIE_SECURE: 'false' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['AUTH_COOKIE_SECURE'],
            message: expect.stringContaining('AUTH_COOKIE_SECURE must be true'),
          }),
        ]),
      );
    }
  });

  it('accepts AUTH_COOKIE_SAME_SITE=none when secure defaults to true', () => {
    const result = envSchema.safeParse(
      productionEnv({ AUTH_COOKIE_SAME_SITE: 'none' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_COOKIE_SECURE).toBe(true);
      expect(result.data.AUTH_COOKIE_SAME_SITE).toBe('none');
    }
  });

  it('rejects AUTH_COOKIE_SAME_SITE=none with AUTH_COOKIE_SECURE=false in production', () => {
    const result = envSchema.safeParse(
      productionEnv({
        AUTH_COOKIE_SAME_SITE: 'none',
        AUTH_COOKIE_SECURE: 'false',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('AUTH_COOKIE_SECURE');
      expect(paths).toContain('AUTH_COOKIE_SAME_SITE');
    }
  });

  it('allows AUTH_COOKIE_SECURE=false in development', () => {
    const result = envSchema.safeParse({
      ...productionEnv({ AUTH_COOKIE_SECURE: 'false' }),
      NODE_ENV: 'development',
      CORS_ORIGINS: 'http://localhost:3000',
      MAIL_TRANSPORT: 'log',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_COOKIE_SECURE).toBe(false);
    }
  });
});

describe('envSchema production guardrails', () => {
  it('rejects placeholder JWT secrets', () => {
    const result = envSchema.safeParse(
      productionEnv({
        JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars!!',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['JWT_ACCESS_SECRET'] }),
        ]),
      );
    }
  });

  it('rejects identical JWT access and refresh secrets', () => {
    const secret = 'c'.repeat(32);
    const result = envSchema.safeParse(
      productionEnv({
        JWT_ACCESS_SECRET: secret,
        JWT_REFRESH_SECRET: secret,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['JWT_REFRESH_SECRET'] }),
        ]),
      );
    }
  });

  it('rejects SWAGGER_ENABLED in production', () => {
    const result = envSchema.safeParse(
      productionEnv({ SWAGGER_ENABLED: 'true' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['SWAGGER_ENABLED'] }),
        ]),
      );
    }
  });

  it('rejects MAIL_TRANSPORT=log in production', () => {
    const result = envSchema.safeParse(
      productionEnv({ MAIL_TRANSPORT: 'log' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['MAIL_TRANSPORT'] }),
        ]),
      );
    }
  });

  it('rejects localhost APP_BASE_URL in production', () => {
    const result = envSchema.safeParse(
      productionEnv({ APP_BASE_URL: 'http://localhost:3000' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['APP_BASE_URL'] }),
        ]),
      );
    }
  });
});
