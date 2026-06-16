import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { redisKeys } from '../common/constants/redis-keys';
import { PrismaService, RedisService } from '@app/shared';
import { RbacAuditAction } from '@prisma/client';
import { RbacAuditService } from './rbac-audit.service';
import { PERMISSIONS } from './permissions.constants';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  let service: RbacService;

  const auditCtx = {
    actorId: 'actor-1',
    actorEmail: 'admin@example.com',
    requestId: 'req-1',
    ipAddress: '127.0.0.1',
  };

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const prisma = {
    user: { findUnique: jest.fn() },
    role: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    permission: { findUnique: jest.fn(), findMany: jest.fn() },
    userRole: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    rolePermission: { create: jest.fn(), delete: jest.fn() },
  };
  const redis = {
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  const customRole = {
    id: 'r1',
    name: 'editor',
    description: 'Editor',
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const adminRole = {
    id: 'admin-r',
    name: 'admin',
    description: 'Admin',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const userRole = {
    id: 'user-r',
    name: 'user',
    description: 'User',
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: {
            get: () => 300,
          },
        },
        { provide: RbacAuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(RbacService);
    jest.clearAllMocks();
  });

  describe('getUserRoles', () => {
    it('returns role names', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'admin' } },
        { role: { name: 'user' } },
      ]);
      await expect(service.getUserRoles('u1')).resolves.toEqual([
        'admin',
        'user',
      ]);
    });
  });

  describe('getUserPermissions', () => {
    it('returns cached permissions when present', async () => {
      redis.getJson.mockResolvedValue([PERMISSIONS.USERS_READ]);
      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        PERMISSIONS.USERS_READ,
      ]);
      expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    });

    it('loads from db and caches on miss', async () => {
      redis.getJson.mockResolvedValue(null);
      prisma.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: [
              { permission: { action: PERMISSIONS.USERS_WRITE } },
              { permission: { action: PERMISSIONS.USERS_READ } },
            ],
          },
        },
      ]);

      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        PERMISSIONS.USERS_READ,
        PERMISSIONS.USERS_WRITE,
      ]);
      expect(redis.setJson).toHaveBeenCalledWith(
        redisKeys.permissionCache('u1'),
        [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_WRITE],
        300,
      );
    });

    it('falls back to db when redis read fails', async () => {
      redis.getJson.mockRejectedValue(new Error('redis down'));
      redis.setJson.mockRejectedValue(new Error('redis down'));
      prisma.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: [{ permission: { action: PERMISSIONS.USERS_READ } }],
          },
        },
      ]);

      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        PERMISSIONS.USERS_READ,
      ]);
      expect(prisma.userRole.findMany).toHaveBeenCalled();
    });

    it('returns db permissions when redis write fails', async () => {
      redis.getJson.mockResolvedValue(null);
      redis.setJson.mockRejectedValue(new Error('redis down'));
      prisma.userRole.findMany.mockResolvedValue([
        {
          role: {
            permissions: [{ permission: { action: PERMISSIONS.USERS_READ } }],
          },
        },
      ]);

      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        PERMISSIONS.USERS_READ,
      ]);
    });
  });

  describe('listPermissions', () => {
    it('returns only catalog permissions', async () => {
      prisma.permission.findMany.mockResolvedValue([]);
      await service.listPermissions();
      expect(prisma.permission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: { in: expect.arrayContaining([PERMISSIONS.USERS_READ]) },
          },
        }),
      );
    });
  });

  describe('createRole', () => {
    it('creates role', async () => {
      prisma.role.create.mockResolvedValue(customRole);
      await expect(
        service.createRole({ name: 'editor', description: 'Editor' }, auditCtx),
      ).resolves.toBe(customRole);
    });

    it('rejects reserved role names', async () => {
      await expect(
        service.createRole({ name: 'admin' }, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.role.create).not.toHaveBeenCalled();
    });

    it('throws conflict on duplicate', async () => {
      prisma.role.create.mockRejectedValue(new Error('unique'));
      await expect(
        service.createRole({ name: 'editor' }, auditCtx),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('records audit log on success', async () => {
      prisma.role.create.mockResolvedValue(customRole);
      await service.createRole({ name: 'editor' }, auditCtx);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: RbacAuditAction.ROLE_CREATED,
          context: auditCtx,
          targetRoleId: customRole.id,
        }),
      );
    });
  });

  describe('updateRole', () => {
    it('updates non-system role', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.role.update.mockResolvedValue({
        ...customRole,
        description: 'New',
      });
      await expect(
        service.updateRole('r1', { description: 'New' }, auditCtx),
      ).resolves.toMatchObject({ description: 'New' });
    });

    it('rejects system role update', async () => {
      prisma.role.findUnique.mockResolvedValue(adminRole);
      await expect(
        service.updateRole('admin-r', { description: 'Hacked' }, auditCtx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects rename to reserved name', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      await expect(
        service.updateRole('r1', { name: 'user' }, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws conflict on duplicate name', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.role.update.mockRejectedValue(new Error('unique'));
      await expect(
        service.updateRole('r1', { name: 'taken' }, auditCtx),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deleteRole', () => {
    it('deletes unassigned non-system role', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.userRole.count.mockResolvedValue(0);
      prisma.role.delete.mockResolvedValue(customRole);
      await expect(service.deleteRole('r1', auditCtx)).resolves.toEqual({
        success: true,
      });
    });

    it('rejects system role delete', async () => {
      prisma.role.findUnique.mockResolvedValue(adminRole);
      await expect(
        service.deleteRole('admin-r', auditCtx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects delete when role has users', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.userRole.count.mockResolvedValue(2);
      await expect(service.deleteRole('r1', auditCtx)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('assignRoleToUser', () => {
    const body = { userId: 'u1', roleId: 'r1' };

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.assignRoleToUser(body, auditCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when role not found', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(
        service.assignRoleToUser(body, auditCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws conflict when role already assigned', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.userRole.create.mockRejectedValue(new Error('unique'));
      await expect(
        service.assignRoleToUser(body, auditCtx),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('assigns role and invalidates cache', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.userRole.create.mockResolvedValue({});
      redis.del.mockResolvedValue(1);

      await expect(service.assignRoleToUser(body, auditCtx)).resolves.toEqual({
        success: true,
      });
      expect(redis.del).toHaveBeenCalledWith(redisKeys.permissionCache('u1'));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: RbacAuditAction.ROLE_ASSIGNED }),
      );
    });
  });

  describe('unassignRoleFromUser', () => {
    const body = { userId: 'u1', roleId: 'admin-r' };

    it('throws when assignment missing', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.userRole.count.mockResolvedValue(0);
      prisma.userRole.delete.mockRejectedValue(new Error('not found'));

      await expect(
        service.unassignRoleFromUser({ userId: 'u1', roleId: 'r1' }, auditCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks unassigning last admin', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(adminRole);
      prisma.userRole.count.mockResolvedValue(1);

      await expect(
        service.unassignRoleFromUser(body, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unassigns when multiple admins exist', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.role.findUnique.mockResolvedValue(adminRole);
      prisma.userRole.count.mockResolvedValue(2);
      prisma.userRole.delete.mockResolvedValue({});

      await expect(
        service.unassignRoleFromUser(body, auditCtx),
      ).resolves.toEqual({
        success: true,
      });
    });
  });

  describe('attachPermissionToRole', () => {
    const body = { roleId: 'r1', permissionId: 'p1' };

    it('throws when role not found', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(
        service.attachPermissionToRole(body, auditCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects permissions outside catalog', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: 'custom:action',
      });

      await expect(
        service.attachPermissionToRole(body, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('attaches catalog permission and invalidates caches', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_READ,
      });
      prisma.rolePermission.create.mockResolvedValue({});
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'u1' }]);
      redis.del.mockResolvedValue(1);

      await expect(
        service.attachPermissionToRole(body, auditCtx),
      ).resolves.toEqual({
        success: true,
      });
    });

    it('throws conflict when permission already attached', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_READ,
      });
      prisma.rolePermission.create.mockRejectedValue(new Error('unique'));

      await expect(
        service.attachPermissionToRole(body, auditCtx),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('detachPermissionFromRole', () => {
    const body = { roleId: 'user-r', permissionId: 'p1' };

    it('throws when link missing', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_READ,
      });
      prisma.rolePermission.delete.mockRejectedValue(new Error('not found'));

      await expect(
        service.detachPermissionFromRole(
          { roleId: 'r1', permissionId: 'p1' },
          auditCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks detaching protected permission from system role', async () => {
      prisma.role.findUnique.mockResolvedValue(userRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_READ,
      });

      await expect(
        service.detachPermissionFromRole(body, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks detaching catalog permission from admin role', async () => {
      prisma.role.findUnique.mockResolvedValue(adminRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_DELETE,
      });

      await expect(
        service.detachPermissionFromRole(body, auditCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.rolePermission.delete).not.toHaveBeenCalled();
    });

    it('detaches permission from non-system role', async () => {
      prisma.role.findUnique.mockResolvedValue(customRole);
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p1',
        action: PERMISSIONS.USERS_DELETE,
      });
      prisma.rolePermission.delete.mockResolvedValue({});
      prisma.userRole.findMany.mockResolvedValue([]);

      await expect(
        service.detachPermissionFromRole(
          { roleId: 'r1', permissionId: 'p1' },
          auditCtx,
        ),
      ).resolves.toEqual({
        success: true,
      });
    });
  });
});
