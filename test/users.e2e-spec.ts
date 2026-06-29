import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  API_V1,
  createE2eApp,
  loginAdmin,
  registerAndVerifyUser,
  teardownE2eApp,
  uniqueName,
} from './e2e-helpers';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;

  beforeAll(async () => {
    app = await createE2eApp();
    adminToken = await loginAdmin(app);
  });

  afterAll(async () => {
    await teardownE2eApp(app);
  });

  it('admin can list users', async () => {
    await request(app.getHttpServer())
      .get(`${API_V1}/users?page=1&limit=5`)
      .set('Authorization', `Bearer ${adminToken}`)
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
    const { accessToken } = await registerAndVerifyUser(app, 'nousers');

    await request(app.getHttpServer())
      .post(`${API_V1}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: `${uniqueName('created')}@example.com`,
        password: 'SecurePass1',
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('Insufficient permissions');
      });
  });

  it('rejects self-update of password and status', async () => {
    const { accessToken, userId } = await registerAndVerifyUser(
      app,
      'selfupdate',
    );

    await request(app.getHttpServer())
      .patch(`${API_V1}/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'NewSecure2' })
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toBe(
          'Use POST /auth/change-password to change your password',
        );
      });

    await request(app.getHttpServer())
      .patch(`${API_V1}/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'INACTIVE' })
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toBe('Cannot update your own status');
      });
  });

  it('blocks deactivated users on protected routes', async () => {
    const { accessToken, userId } = await registerAndVerifyUser(
      app,
      'deactivated',
    );

    await request(app.getHttpServer())
      .patch(`${API_V1}/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' })
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('INACTIVE');
      });

    await request(app.getHttpServer())
      .get(`${API_V1}/auth/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('Account is inactive');
      });

    await request(app.getHttpServer())
      .get(`${API_V1}/users?page=1&limit=5`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('Account is inactive');
      });
  });
});
