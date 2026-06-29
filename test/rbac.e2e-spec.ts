import { INestApplication } from '@nestjs/common';
import { RbacAuditAction } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '@app/shared';
import {
  API_V1,
  createE2eApp,
  loginAdmin,
  registerAndVerifyUser,
  teardownE2eApp,
  uniqueName,
  VerifiedUser,
} from './e2e-helpers';

describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    adminToken = await loginAdmin(app);
  });

  afterAll(async () => {
    await teardownE2eApp(app);
  });

  const expectAuditLog = async (
    action: RbacAuditAction,
    filter: {
      targetRoleId?: string;
      targetUserId?: string;
      targetPermissionId?: string;
    },
  ) => {
    const logs = await prisma.rbacAuditLog.findMany({
      where: { action, ...filter },
      orderBy: { createdAt: 'desc' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].actorEmail).toBeDefined();
  };

  describe('read access', () => {
    it('admin can list roles after seed login', async () => {
      await request(app.getHttpServer())
        .get(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(
            res.body.some((r: { name: string }) => r.name === 'admin'),
          ).toBe(true);
        });
    });

    it('non-admin cannot list roles', async () => {
      const { accessToken } = await registerAndVerifyUser(app, 'norole');
      await request(app.getHttpServer())
        .get(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Insufficient permissions');
        });
    });
  });

  describe('mutations', () => {
    let customRoleId: string;
    let usersWritePermissionId: string;
    let testUser: VerifiedUser;

    beforeAll(async () => {
      const permissionsRes = await request(app.getHttpServer())
        .get(`${API_V1}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const usersWrite = permissionsRes.body.find(
        (p: { action: string }) => p.action === 'users:write',
      );
      expect(usersWrite).toBeDefined();
      usersWritePermissionId = usersWrite.id as string;

      testUser = await registerAndVerifyUser(app, 'rbac-target');
    });

    it('admin can list permissions', async () => {
      await request(app.getHttpServer())
        .get(`${API_V1}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(
            res.body.some((p: { action: string }) => p.action === 'users:read'),
          ).toBe(true);
        });
    });

    it('creates a custom role', async () => {
      const roleName = uniqueName('editor');

      const res = await request(app.getHttpServer())
        .post(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: roleName, description: 'Test editor role' })
        .expect(201);

      customRoleId = res.body.id as string;
      expect(res.body.name).toBe(roleName);
      expect(res.body.isSystem).toBe(false);

      await expectAuditLog(RbacAuditAction.ROLE_CREATED, {
        targetRoleId: customRoleId,
      });
    });

    it('updates a custom role', async () => {
      const updatedName = uniqueName('editor-upd');

      const res = await request(app.getHttpServer())
        .patch(`${API_V1}/roles/${customRoleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: updatedName, description: 'Updated description' })
        .expect(200);

      expect(res.body.name).toBe(updatedName);

      await expectAuditLog(RbacAuditAction.ROLE_UPDATED, {
        targetRoleId: customRoleId,
      });
    });

    it('attaches a permission to a custom role', async () => {
      await request(app.getHttpServer())
        .post(`${API_V1}/roles/permissions/attach`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: customRoleId, permissionId: usersWritePermissionId })
        .expect(201);

      await expectAuditLog(RbacAuditAction.PERMISSION_ATTACHED, {
        targetRoleId: customRoleId,
        targetPermissionId: usersWritePermissionId,
      });
    });

    it('assigns a role and reflects permissions on /auth/me', async () => {
      const beforeLoginRes = await request(app.getHttpServer())
        .post(`${API_V1}/auth/login`)
        .send({ email: testUser.email, password: testUser.password })
        .expect(201);

      await request(app.getHttpServer())
        .get(`${API_V1}/auth/me`)
        .set('Authorization', `Bearer ${beforeLoginRes.body.accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.permissions).toContain('users:read');
          expect(res.body.permissions).not.toContain('users:write');
        });

      await request(app.getHttpServer())
        .post(`${API_V1}/roles/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: testUser.userId, roleId: customRoleId })
        .expect(201);

      await expectAuditLog(RbacAuditAction.ROLE_ASSIGNED, {
        targetUserId: testUser.userId,
        targetRoleId: customRoleId,
      });

      const loginRes = await request(app.getHttpServer())
        .post(`${API_V1}/auth/login`)
        .send({ email: testUser.email, password: testUser.password })
        .expect(201);

      await request(app.getHttpServer())
        .get(`${API_V1}/auth/me`)
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.permissions).toContain('users:read');
          expect(res.body.permissions).toContain('users:write');
        });
    });

    it('detaches a permission from a custom role', async () => {
      await request(app.getHttpServer())
        .post(`${API_V1}/roles/permissions/detach`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: customRoleId, permissionId: usersWritePermissionId })
        .expect(201);

      await expectAuditLog(RbacAuditAction.PERMISSION_DETACHED, {
        targetRoleId: customRoleId,
        targetPermissionId: usersWritePermissionId,
      });
    });

    it('unassigns a role from a user', async () => {
      await request(app.getHttpServer())
        .post(`${API_V1}/roles/unassign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: testUser.userId, roleId: customRoleId })
        .expect(201);

      await expectAuditLog(RbacAuditAction.ROLE_UNASSIGNED, {
        targetUserId: testUser.userId,
        targetRoleId: customRoleId,
      });
    });

    it('deletes an empty custom role', async () => {
      await request(app.getHttpServer())
        .delete(`${API_V1}/roles/${customRoleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await expectAuditLog(RbacAuditAction.ROLE_DELETED, {
        targetRoleId: customRoleId,
      });
    });

    it('rejects PATCH and DELETE on system admin role', async () => {
      const rolesRes = await request(app.getHttpServer())
        .get(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const adminRole = rolesRes.body.find(
        (r: { name: string }) => r.name === 'admin',
      );
      expect(adminRole).toBeDefined();

      await request(app.getHttpServer())
        .patch(`${API_V1}/roles/${adminRole.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: 'Hacked' })
        .expect(403);

      await request(app.getHttpServer())
        .delete(`${API_V1}/roles/${adminRole.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('rejects unassigning the last admin assignment', async () => {
      const rolesRes = await request(app.getHttpServer())
        .get(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const adminRole = rolesRes.body.find(
        (r: { name: string }) => r.name === 'admin',
      );
      const adminUser = await prisma.user.findFirst({
        where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com' },
      });
      expect(adminUser).toBeDefined();

      await request(app.getHttpServer())
        .post(`${API_V1}/roles/unassign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: adminUser!.id, roleId: adminRole.id })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBe(
            'Cannot remove the last admin assignment',
          );
        });
    });

    it('rejects RBAC mutations from non-admin users', async () => {
      const { accessToken } = await registerAndVerifyUser(app, 'nonadmin');

      await request(app.getHttpServer())
        .post(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: uniqueName('forbidden'), description: 'nope' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Insufficient permissions');
        });

      await request(app.getHttpServer())
        .get(`${API_V1}/permissions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Insufficient permissions');
        });

      const rolesRes = await request(app.getHttpServer())
        .get(`${API_V1}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const adminRole = rolesRes.body.find(
        (r: { name: string }) => r.name === 'admin',
      );

      await request(app.getHttpServer())
        .patch(`${API_V1}/roles/${adminRole.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: 'nope' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Insufficient permissions');
        });

      await request(app.getHttpServer())
        .post(`${API_V1}/roles/assign`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: 'fake', roleId: adminRole.id })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('Insufficient permissions');
        });
    });
  });
});
