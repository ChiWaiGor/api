import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  API_ERROR_CODES,
  API_V1,
  createE2eApp,
  expectApiErrorBody,
  teardownE2eApp,
} from './e2e-helpers';

/**
 * Dedicated suite with tight auth limits. Restores env afterward so other
 * e2e files (same Jest worker) still see the raised THROTTLE_AUTH_LIMIT from
 * e2e-setup.
 */
describe('Throttling (e2e)', () => {
  let app: INestApplication<App>;
  const previousAuthLimit = process.env.THROTTLE_AUTH_LIMIT;
  const previousLimit = process.env.THROTTLE_LIMIT;
  const previousTtl = process.env.THROTTLE_TTL;
  const previousAuthTtl = process.env.THROTTLE_AUTH_TTL;

  const authLimit = 3;
  const defaultLimit = 20;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = String(authLimit);
    process.env.THROTTLE_LIMIT = String(defaultLimit);
    process.env.THROTTLE_TTL = '60000';
    process.env.THROTTLE_AUTH_TTL = '60000';
    app = await createE2eApp();
  });

  afterAll(async () => {
    await teardownE2eApp(app);
    process.env.THROTTLE_AUTH_LIMIT = previousAuthLimit;
    process.env.THROTTLE_LIMIT = previousLimit;
    process.env.THROTTLE_TTL = previousTtl;
    process.env.THROTTLE_AUTH_TTL = previousAuthTtl;
  });

  it('does not apply the auth throttler to normal routes', async () => {
    // authLimit+2 would 429 if auth/auth-refresh applied globally.
    for (let i = 0; i < authLimit + 2; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });

  it('enforces the auth throttler on login', async () => {
    const body = {
      email: 'throttle-login@example.com',
      password: 'WrongPass1!',
    };

    for (let i = 0; i < authLimit; i++) {
      const res = await request(app.getHttpServer())
        .post(`${API_V1}/auth/login`)
        .send(body);
      // Wrong credentials → 401; still counts toward the auth bucket.
      expect(res.status).toBe(401);
    }

    const blocked = await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send(body);

    expect(blocked.status).toBe(429);
    expectApiErrorBody(blocked.body, {
      statusCode: 429,
      code: API_ERROR_CODES.TOO_MANY_REQUESTS,
      path: `${API_V1}/auth/login`,
    });
  });

  it('enforces auth-refresh without being capped by the auth limit', async () => {
    // Separate Redis key from login (`auth-refresh` vs `auth`); limit is 2×.
    const refreshLimit = authLimit * 2;
    const body = { refreshToken: 'not-a-real-refresh-token' };

    for (let i = 0; i < refreshLimit; i++) {
      const res = await request(app.getHttpServer())
        .post(`${API_V1}/auth/refresh`)
        .send(body);
      expect([400, 401]).toContain(res.status);
    }

    const blocked = await request(app.getHttpServer())
      .post(`${API_V1}/auth/refresh`)
      .send(body);

    expect(blocked.status).toBe(429);
    expectApiErrorBody(blocked.body, {
      statusCode: 429,
      code: API_ERROR_CODES.TOO_MANY_REQUESTS,
      path: `${API_V1}/auth/refresh`,
    });
  });
});
