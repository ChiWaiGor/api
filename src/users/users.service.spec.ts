import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthCryptoService } from '../auth/auth-crypto.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { RbacService } from '../rbac/rbac.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const prisma = {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    role: { findUnique: jest.fn(), findMany: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const crypto = { hash: jest.fn() };
  const auth = {
    requestEmailVerification: jest.fn(),
    invalidateUserSessionStateCache: jest.fn(),
  };
  const rbac = { invalidateUserPermissionCache: jest.fn() };

  const userRow = {
    id: 'user-1',
    email: 'a@b.com',
    status: UserStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    roles: [{ role: { name: 'user' } }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthCryptoService, useValue: crypto },
        { provide: AuthService, useValue: auth },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns paginated users', async () => {
      prisma.user.count.mockResolvedValue(25);
      prisma.user.findMany.mockResolvedValue([userRow]);

      const result = await service.findAll({ page: 2, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('applies search filter when provided', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ page: 1, limit: 10, search: 'admin' });

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          email: { contains: 'admin', mode: 'insensitive' },
        },
      });
    });
  });

  describe('findOne', () => {
    it('allows self lookup without users:read', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      const result = await service.findOne('user-1', 'user-1', []);
      expect(result.id).toBe('user-1');
    });

    it('forbids reading other users without permission', async () => {
      await expect(
        service.findOne('other', 'user-1', []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows reading other users with users:read', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      const result = await service.findOne('user-1', 'admin-1', [
        PERMISSIONS.USERS_READ,
      ]);
      expect(result.email).toBe('a@b.com');
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.findOne('missing', 'admin-1', [PERMISSIONS.USERS_READ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('throws when email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x' });
      await expect(
        service.create({ email: 'a@b.com', password: 'SecurePass1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws for invalid roleNames', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      crypto.hash.mockResolvedValue('hash');
      prisma.role.findMany.mockResolvedValue([{ name: 'user' }]);

      await expect(
        service.create({
          email: 'new@b.com',
          password: 'SecurePass1',
          roleNames: ['user', 'nonexistent'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates user with default role and invalidates cache', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      crypto.hash.mockResolvedValue('hash');
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'user' });
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'user' }]);
      prisma.user.create.mockResolvedValue(userRow);
      rbac.invalidateUserPermissionCache.mockResolvedValue(undefined);

      const result = await service.create({
        email: 'new@b.com',
        password: 'SecurePass1',
      });

      expect(result.email).toBe('a@b.com');
      expect(rbac.invalidateUserPermissionCache).toHaveBeenCalledWith('user-1');
    });
  });

  describe('update', () => {
    it('forbids updating other users without users:write', async () => {
      await expect(
        service.update('other', { email: 'x@b.com' }, 'user-1', []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.update('user-1', {}, 'user-1', []),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when email already in use', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(userRow)
        .mockResolvedValueOnce({ id: 'other' });
      await expect(
        service.update('user-1', { email: 'taken@b.com' }, 'user-1', [
          PERMISSIONS.USERS_WRITE,
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects self password change', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);

      await expect(
        service.update('user-1', { password: 'NewSecure1' }, 'user-1', []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects self status change', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);

      await expect(
        service.update(
          'user-1',
          { status: UserStatus.INACTIVE },
          'user-1',
          [PERMISSIONS.USERS_WRITE],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resets emailVerifiedAt and sends verification when email changes', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ ...userRow, emailVerifiedAt: new Date() })
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue(userRow);
      auth.requestEmailVerification.mockResolvedValue({ success: true });

      await service.update(
        'user-1',
        { email: 'new@b.com' },
        'user-1',
        [],
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@b.com',
            emailVerifiedAt: null,
          }),
        }),
      );
      expect(auth.requestEmailVerification).toHaveBeenCalledWith('user-1');
    });

    it('revokes refresh tokens when admin changes another user password', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      crypto.hash.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue(userRow);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'user-2',
        { password: 'NewSecure1' },
        'admin-1',
        [PERMISSIONS.USERS_WRITE],
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-2', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(rbac.invalidateUserPermissionCache).toHaveBeenCalledWith('user-2');
    });

    it('allows admin to update another user status', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      prisma.user.update.mockResolvedValue({
        ...userRow,
        status: UserStatus.INACTIVE,
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.update(
        'user-2',
        { status: UserStatus.INACTIVE },
        'admin-1',
        [PERMISSIONS.USERS_WRITE],
      );

      expect(result.status).toBe(UserStatus.INACTIVE);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: UserStatus.INACTIVE },
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-2', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(auth.invalidateUserSessionStateCache).toHaveBeenCalledWith('user-2');
    });

    it('does not revoke refresh tokens when status is unchanged', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      prisma.user.update.mockResolvedValue(userRow);

      await service.update(
        'user-2',
        { status: UserStatus.ACTIVE },
        'admin-1',
        [PERMISSIONS.USERS_WRITE],
      );

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('soft deletes the user, revokes tokens, and invalidates cache', async () => {
      prisma.user.findUnique.mockResolvedValue(userRow);
      prisma.user.update.mockResolvedValue(userRow);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.remove('user-1')).resolves.toEqual({
        success: true,
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { deletedAt: expect.any(Date) },
        }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(rbac.invalidateUserPermissionCache).toHaveBeenCalledWith('user-1');
    });
  });
});
