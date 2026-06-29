import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MailQueueService } from '@app/queue';
import { PrismaService } from '@app/shared';
import {
  API_V1,
  createE2eApp,
  extractPasswordResetTokenFromMail,
  extractVerificationTokenFromMail,
  parseSetCookieHeader,
  registerAndVerifyUser,
  teardownE2eApp,
  uniqueName,
} from './e2e-helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await teardownE2eApp(app);
  });

  it('registers, logs in, accesses protected route, refreshes, and logs out', async () => {
    const email = `${uniqueName('user')}@example.com`;
    const password = 'SecurePass1';

    const registerRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    expect(registerRes.body.accessToken).toBeDefined();
    expect(registerRes.body.refreshToken).toBeDefined();

    const loginRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password })
      .expect(201);

    const { accessToken, refreshToken } = loginRes.body;

    await request(app.getHttpServer())
      .get(`${API_V1}/auth/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.email).toBe(email);
        expect(res.body.roles).toContain('user');
      });

    const refreshRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/refresh`)
      .send({ refreshToken })
      .expect(201);

    const newAccess = refreshRes.body.accessToken as string;
    const newRefresh = refreshRes.body.refreshToken as string;

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/logout`)
      .set('Authorization', `Bearer ${newAccess}`)
      .send({ refreshToken: newRefresh })
      .expect(201);

    await request(app.getHttpServer())
      .get(`${API_V1}/auth/me`)
      .set('Authorization', `Bearer ${newAccess}`)
      .expect(401);
  });

  it('rejects duplicate registration', async () => {
    const email = `${uniqueName('dup')}@example.com`;
    const password = 'SecurePass1';

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(409);
  });

  it('rejects invalid login credentials', async () => {
    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email: 'nobody@example.com', password: 'SecurePass1' })
      .expect(401);
  });

  it('rejects weak passwords on register', async () => {
    await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email: `${uniqueName('weak')}@example.com`, password: 'short' })
      .expect(400);
  });

  it('rejects unknown fields on register', async () => {
    await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({
        email: `${uniqueName('extra')}@example.com`,
        password: 'SecurePass1',
        isAdmin: true,
      })
      .expect(400);
  });

  it('rejects reused refresh token after rotation', async () => {
    const email = `${uniqueName('refresh')}@example.com`;
    const password = 'SecurePass1';

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password })
      .expect(201);

    const oldRefresh = loginRes.body.refreshToken as string;

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/refresh`)
      .send({ refreshToken: oldRefresh })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/refresh`)
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });

  it('rejects unauthenticated access to /auth/me', async () => {
    await request(app.getHttpServer()).get(`${API_V1}/auth/me`).expect(401);
  });

  it('grants domain API access after register and email verification confirm', async () => {
    const mailQueue = app.get(MailQueueService);
    const enqueueSpy = jest.spyOn(mailQueue, 'enqueueSend');
    const email = `${uniqueName('verified')}@example.com`;
    const password = 'SecurePass1';

    const registerRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    const { accessToken } = registerRes.body;

    await request(app.getHttpServer())
      .get(`${API_V1}/users?page=1&limit=5`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('Email verification required');
      });

    const verificationCall = enqueueSpy.mock.calls.find(
      ([msg]) =>
        msg.subject === 'Verify your email address' && msg.to === email,
    );
    expect(verificationCall).toBeDefined();
    const token = extractVerificationTokenFromMail(verificationCall![0].text);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/email-verification/confirm`)
      .send({ token })
      .expect(200);

    enqueueSpy.mockRestore();

    await request(app.getHttpServer())
      .get(`${API_V1}/users?page=1&limit=5`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body.data)).toBe(true);
      });
  });

  it('rejects change-password for unverified users', async () => {
    const email = `${uniqueName('unverified-pw')}@example.com`;
    const password = 'SecurePass1';

    const registerRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/change-password`)
      .set('Authorization', `Bearer ${registerRes.body.accessToken}`)
      .send({ currentPassword: password, newPassword: 'NewSecure2' })
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('Email verification required');
      });
  });

  it('changes password via dedicated endpoint and revokes refresh tokens', async () => {
    const { email, password, accessToken, refreshToken } =
      await registerAndVerifyUser(app, 'changepw');
    const newPassword = 'NewSecure2';

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass1', newPassword })
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('Invalid current password');
      });

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: password, newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/refresh`)
      .send({ refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password: newPassword })
      .expect(201);
  });

  it('allows unverified users on auth allowlist routes but blocks other APIs', async () => {
    const email = `${uniqueName('unverified')}@example.com`;
    const password = 'SecurePass1';

    const registerRes = await request(app.getHttpServer())
      .post(`${API_V1}/auth/register`)
      .send({ email, password })
      .expect(201);

    const { accessToken } = registerRes.body;

    await request(app.getHttpServer())
      .get(`${API_V1}/auth/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.emailVerified).toBe(false);
      });

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/email-verification/request`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`${API_V1}/users?page=1&limit=5`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('Email verification required');
      });
  });

  it('completes password reset request and confirm flow', async () => {
    const { email, password } = await registerAndVerifyUser(app, 'pwreset');
    const newPassword = 'ResetSecure2';
    const mailQueue = app.get(MailQueueService);
    const enqueueSpy = jest.spyOn(mailQueue, 'enqueueSend');

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/password-reset/request`)
      .send({ email })
      .expect(200);

    const resetCall = enqueueSpy.mock.calls.find(
      ([msg]) => msg.subject === 'Reset your password' && msg.to === email,
    );
    expect(resetCall).toBeDefined();
    const token = extractPasswordResetTokenFromMail(resetCall![0].text);

    enqueueSpy.mockRestore();

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/password-reset/confirm`)
      .send({ token, newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password: newPassword })
      .expect(201);
  });

  it('locks account after repeated failed logins', async () => {
    const { email, password, userId } = await registerAndVerifyUser(
      app,
      'lockout',
    );
    const maxAttempts = Number(process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? '3');
    const prisma = app.get(PrismaService);

    for (let i = 0; i < maxAttempts; i += 1) {
      await request(app.getHttpServer())
        .post(`${API_V1}/auth/login`)
        .send({ email, password: 'WrongPass1' })
        .expect(401);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('LOCKED');

    await request(app.getHttpServer())
      .post(`${API_V1}/auth/login`)
      .send({ email, password })
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toContain('Account is locked');
      });
  });

  describe('web cookie auth (X-Auth-Client: web)', () => {
    it('sets httpOnly cookies and omits tokens from the response body', async () => {
      const email = `${uniqueName('web')}@example.com`;
      const password = 'SecurePass1';
      const agent = request.agent(app.getHttpServer());

      await agent
        .post(`${API_V1}/auth/register`)
        .set('X-Auth-Client', 'web')
        .send({ email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body.accessToken).toBeUndefined();
          expect(res.body.refreshToken).toBeUndefined();
          expect(res.headers['set-cookie']).toBeDefined();
        });

      await agent
        .get(`${API_V1}/auth/me`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe(email);
        });
    });

    it('refreshes and logs out with CSRF protection', async () => {
      const email = `${uniqueName('web-csrf')}@example.com`;
      const password = 'SecurePass1';
      const agent = request.agent(app.getHttpServer());

      await agent
        .post(`${API_V1}/auth/register`)
        .set('X-Auth-Client', 'web')
        .send({ email, password })
        .expect(201);

      const loginRes = await agent
        .post(`${API_V1}/auth/login`)
        .set('X-Auth-Client', 'web')
        .send({ email, password })
        .expect(201);

      const csrf = parseSetCookieHeader(
        loginRes.headers['set-cookie'],
      ).csrf_token;
      expect(csrf).toBeDefined();

      await agent
        .post(`${API_V1}/auth/refresh`)
        .set('X-Auth-Client', 'web')
        .send({})
        .expect(403);

      const refreshRes = await agent
        .post(`${API_V1}/auth/refresh`)
        .set('X-Auth-Client', 'web')
        .set('X-CSRF-Token', csrf)
        .send({})
        .expect(201);

      const refreshCsrf = parseSetCookieHeader(
        refreshRes.headers['set-cookie'],
      ).csrf_token;

      await agent
        .post(`${API_V1}/auth/logout`)
        .set('X-CSRF-Token', refreshCsrf)
        .send({})
        .expect(201);

      await agent.get(`${API_V1}/auth/me`).expect(401);
    });

    it('still returns bearer tokens for mobile clients (default)', async () => {
      const email = `${uniqueName('mobile')}@example.com`;
      const password = 'SecurePass1';

      await request(app.getHttpServer())
        .post(`${API_V1}/auth/register`)
        .send({ email, password })
        .expect(201)
        .expect((res) => {
          expect(res.body.accessToken).toBeDefined();
          expect(res.body.refreshToken).toBeDefined();
        });
    });
  });
});
