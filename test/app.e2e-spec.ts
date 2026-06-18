import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MailQueueService } from '@app/queue';
import { PrismaService, RedisService } from '@app/shared';
import { AppModule } from '../apps/api/src/app.module';

const extractVerificationTokenFromMail = (text: string): string => {
  const match = text.match(/token=([a-f0-9]{64})/);
  if (!match) {
    throw new Error('Verification token not found in mail body');
  }
  return match[1];
};

type VerifiedUser = {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
};

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  const adminCredentials = {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!@#',
  };

  const loginAdmin = async (): Promise<string | null> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send(adminCredentials);
    if (res.status !== 201) return null;
    return res.body.accessToken as string;
  };

  const registerAndVerifyUser = async (
    prefix: string,
    password = 'SecurePass1',
  ): Promise<VerifiedUser> => {
    const email = `${prefix}-${Date.now()}@example.com`;
    const mailQueue = app.get(MailQueueService);
    const enqueueSpy = jest.spyOn(mailQueue, 'enqueueSend');

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const verificationCall = enqueueSpy.mock.calls.find(
      ([msg]) =>
        msg.subject === 'Verify your email address' && msg.to === email,
    );
    expect(verificationCall).toBeDefined();
    const token = extractVerificationTokenFromMail(verificationCall![0].text);

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(200);

    enqueueSpy.mockRestore();

    const accessToken = registerRes.body.accessToken as string;
    const refreshToken = registerRes.body.refreshToken as string;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
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
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const redis = app.get(RedisService);
    await redis.connect();
    await redis.getClient().flushdb();

    const prisma = app.get(PrismaService);
    await prisma.user.updateMany({
      where: { email: adminCredentials.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  });

  afterAll(async () => {
    if (!app) return;
    try {
      const prisma = app.get(PrismaService);
      await prisma.rbacAuditLog.deleteMany();
      await prisma.user.deleteMany({
        where: { email: { not: adminCredentials.email } },
      });
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
  });

  describe('Auth flow', () => {
    it('registers, logs in, accesses protected route, refreshes, and logs out', async () => {
      const email = `user-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      expect(registerRes.body.accessToken).toBeDefined();
      expect(registerRes.body.refreshToken).toBeDefined();

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);

      const { accessToken, refreshToken } = loginRes.body;

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe(email);
          expect(res.body.roles).toContain('user');
        });

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      const newAccess = refreshRes.body.accessToken as string;
      const newRefresh = refreshRes.body.refreshToken as string;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${newAccess}`)
        .send({ refreshToken: newRefresh })
        .expect(201);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${newAccess}`)
        .expect(401);
    });

    it('rejects duplicate registration', async () => {
      const email = `dup-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(409);
    });

    it('rejects invalid login credentials', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'SecurePass1' })
        .expect(401);
    });

    it('rejects weak passwords on register', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: `weak-${Date.now()}@example.com`, password: 'short' })
        .expect(400);
    });

    it('rejects reused refresh token after rotation', async () => {
      const email = `refresh-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);

      const oldRefresh = loginRes.body.refreshToken as string;

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: oldRefresh })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: oldRefresh })
        .expect(401);
    });

    it('rejects unauthenticated access to /auth/me', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('grants domain API access after register and email verification confirm', async () => {
      const mailQueue = app.get(MailQueueService);
      const enqueueSpy = jest.spyOn(mailQueue, 'enqueueSend');
      const email = `verified-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const { accessToken } = registerRes.body;

      await request(app.getHttpServer())
        .get('/users?page=1&limit=5')
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
        .post('/auth/email-verification/confirm')
        .send({ token })
        .expect(200);

      enqueueSpy.mockRestore();

      await request(app.getHttpServer())
        .get('/users?page=1&limit=5')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('rejects change-password for unverified users', async () => {
      const email = `unverified-pw-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${registerRes.body.accessToken}`)
        .send({ currentPassword: password, newPassword: 'NewSecure2' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Email verification required');
        });
    });

    it('changes password via dedicated endpoint and revokes refresh tokens', async () => {
      const { email, password, accessToken, refreshToken } =
        await registerAndVerifyUser('changepw');
      const newPassword = 'NewSecure2';

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'WrongPass1', newPassword })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toBe('Invalid current password');
        });

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: password, newPassword })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: newPassword })
        .expect(201);
    });

    it('allows unverified users on auth allowlist routes but blocks other APIs', async () => {
      const email = `unverified-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const { accessToken } = registerRes.body;

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.emailVerified).toBe(false);
        });

      await request(app.getHttpServer())
        .post('/auth/email-verification/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/users?page=1&limit=5')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Email verification required');
        });
    });
  });

  describe('Health', () => {
    it('health endpoints respond', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/health/ready').expect(200);
    });
  });

  describe('RBAC', () => {
    it('admin can list roles after seed login', async () => {
      const token = await loginAdmin();
      if (!token) {
        console.warn('Skipping admin test: seed admin not available');
        return;
      }

      await request(app.getHttpServer())
        .get('/roles')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(
            res.body.some((r: { name: string }) => r.name === 'admin'),
          ).toBe(true);
        });
    });

    it('non-admin cannot list roles', async () => {
      const email = `norole-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      await request(app.getHttpServer())
        .get('/roles')
        .set('Authorization', `Bearer ${registerRes.body.accessToken}`)
        .expect(403);
    });
  });

  describe('Users', () => {
    it('admin can list users', async () => {
      const token = await loginAdmin();
      if (!token) {
        console.warn('Skipping users test: seed admin not available');
        return;
      }

      await request(app.getHttpServer())
        .get('/users?page=1&limit=5')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.meta).toMatchObject({
            page: 1,
            limit: 5,
          });
        });
    });

    it('regular user cannot create users', async () => {
      const email = `nousers-${Date.now()}@example.com`;
      const password = 'SecurePass1';

      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${registerRes.body.accessToken}`)
        .send({
          email: `created-${Date.now()}@example.com`,
          password: 'SecurePass1',
        })
        .expect(403);
    });

    it('rejects self-update of password and status', async () => {
      const { accessToken, userId } = await registerAndVerifyUser('selfupdate');

      await request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: 'NewSecure2' })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe(
            'Use POST /auth/change-password to change your password',
          );
        });

      await request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'INACTIVE' })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe('Cannot update your own status');
        });
    });

    it('blocks deactivated users on protected routes', async () => {
      const { accessToken, userId } =
        await registerAndVerifyUser('deactivated');
      const adminToken = await loginAdmin();
      if (!adminToken) {
        console.warn(
          'Skipping deactivated user test: seed admin not available',
        );
        return;
      }

      await request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('INACTIVE');
        });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toBe('Account is inactive');
        });

      await request(app.getHttpServer())
        .get('/users?page=1&limit=5')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toBe('Account is inactive');
        });
    });
  });
});
