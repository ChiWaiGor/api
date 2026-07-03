import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MailQueueService } from '@app/queue';
import { PrismaService, RedisService } from '@app/shared';
import { API_V1_PREFIX, configureHttpApp } from '../apps/api/src/app-config';
import { AppModule } from '../apps/api/src/app.module';
import {
  API_ERROR_CODES,
  type ApiErrorCode,
} from '../apps/api/src/common/filters/api-error.util';

/** Base path for versioned API routes in e2e tests. */
export const API_V1 = API_V1_PREFIX;

export type ApiErrorBodyExpectation = {
  statusCode: number;
  code: ApiErrorCode;
  message?: string;
  path?: string;
};

/** Asserts a response body matches the public ApiErrorBody contract. */
export const expectApiErrorBody = (
  body: unknown,
  expected: ApiErrorBodyExpectation,
): void => {
  expect(body).toEqual(
    expect.objectContaining({
      statusCode: expected.statusCode,
      code: expected.code,
      message: expected.message ?? expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      path: expected.path ?? expect.any(String),
    }),
  );
  expect(body).not.toHaveProperty('error');

  const record = body as { details?: unknown };
  if (record.details !== undefined) {
    expect(Array.isArray(record.details)).toBe(true);
  }
};

export { API_ERROR_CODES };

export const adminCredentials = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!@#',
};

export type VerifiedUser = {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
};

export const uniqueName = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const parseSetCookieHeader = (
  setCookie: string | string[] | undefined,
): Record<string, string> => {
  const headers = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return Object.fromEntries(
    headers.map((header) => {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      return [name, value];
    }),
  );
};

export const extractTokenFromMail = (text: string, path: string): string => {
  const match = text.match(
    new RegExp(`${path.replace('/', '\\/')}\\?token=([a-f0-9]{64})`),
  );
  if (!match) {
    throw new Error(`Token not found in mail body for path ${path}`);
  }
  return match[1];
};

export const extractVerificationTokenFromMail = (text: string): string =>
  extractTokenFromMail(text, '/verify-email');

export const extractPasswordResetTokenFromMail = (text: string): string =>
  extractTokenFromMail(text, '/reset-password');

export async function createE2eApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureHttpApp(app);
  await app.init();

  const redis = app.get(RedisService);
  await redis.connect();
  await redis.getClient().flushdb();

  const prisma = app.get(PrismaService);
  await prisma.user.updateMany({
    where: { email: adminCredentials.email, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });

  return app;
}

export async function teardownE2eApp(
  app: INestApplication<App>,
): Promise<void> {
  if (!app) return;
  try {
    const prisma = app.get(PrismaService);
    await prisma.rbacAuditLog.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { not: adminCredentials.email } },
    });
    await prisma.role.deleteMany({ where: { isSystem: false } });
  } catch {
    // DB cleanup is best-effort if setup failed early.
  }
  try {
    const redis = app.get(RedisService);
    await redis.getClient()?.flushdb();
  } catch {
    // Redis may not have connected if setup failed early.
  }
  await app.close();
}

export async function loginAdmin(app: INestApplication<App>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`${API_V1}/auth/login`)
    .send(adminCredentials);

  expect(res.status).toBe(201);
  expect(res.body.accessToken).toBeDefined();
  return res.body.accessToken as string;
}

export async function registerAndVerifyUser(
  app: INestApplication<App>,
  prefix: string,
  password = 'SecurePass1',
): Promise<VerifiedUser> {
  const email = `${uniqueName(prefix)}@example.com`;
  const mailQueue = app.get(MailQueueService);
  const enqueueSpy = jest.spyOn(mailQueue, 'enqueueSend');

  const registerRes = await request(app.getHttpServer())
    .post(`${API_V1}/auth/register`)
    .send({ email, password })
    .expect(201);

  const verificationCall = enqueueSpy.mock.calls.find(
    ([msg]) => msg.subject === 'Verify your email address' && msg.to === email,
  );
  expect(verificationCall).toBeDefined();
  const token = extractVerificationTokenFromMail(verificationCall![0].text);

  await request(app.getHttpServer())
    .post(`${API_V1}/auth/email-verification/confirm`)
    .send({ token })
    .expect(200);

  enqueueSpy.mockRestore();

  const accessToken = registerRes.body.accessToken as string;
  const refreshToken = registerRes.body.refreshToken as string;

  const meRes = await request(app.getHttpServer())
    .get(`${API_V1}/auth/me`)
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200)
    .expect((res) => {
      expect(res.body.emailVerified).toBe(true);
    });

  return {
    email,
    password,
    accessToken,
    refreshToken,
    userId: meRes.body.id as string,
  };
}
