import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
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
          expect(res.body.some((r: { name: string }) => r.name === 'admin')).toBe(
            true,
          );
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
  });
});
