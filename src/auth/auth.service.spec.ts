import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { redisKeys } from '../common/constants/redis-keys';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    role: { findUnique: jest.fn() },
  };
  const crypto = { hash: jest.fn(), verify: jest.fn() };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const redis = { setex: jest.fn(), exists: jest.fn() };
  const rbac = {
    getUserRoles: jest.fn(),
    getUserPermissions: jest.fn(),
    invalidateUserPermissionCache: jest.fn(),
  };

  const activeUser = {
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: 'hash',
    status: UserStatus.ACTIVE,
    roles: [{ role: { name: 'user' } }],
  };

  const setupTokenMocks = () => {
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });
    prisma.refreshToken.update.mockResolvedValue({});
    jwt.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');
    rbac.getUserRoles.mockResolvedValue(['user']);
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthCryptoService, useValue: crypto },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string | number> = {
                JWT_ACCESS_SECRET: 'a'.repeat(32),
                JWT_REFRESH_SECRET: 'b'.repeat(32),
                JWT_ACCESS_TTL: '15m',
                JWT_REFRESH_TTL: '7d',
              };
              return map[key];
            },
          },
        },
        { provide: RedisService, useValue: redis },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('throws when email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x' });
      await expect(
        service.register({ email: 'a@b.com', password: 'SecurePass1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates user and returns token pair', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      crypto.hash.mockResolvedValue('hashed');
      prisma.role.findUnique.mockResolvedValue({ id: 'role-user' });
      prisma.user.create.mockResolvedValue(activeUser);
      setupTokenMocks();

      const result = await service.register({
        email: 'a@b.com',
        password: 'SecurePass1',
      });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ tokenHash: expect.any(String) }),
        }),
      );
    });
  });

  describe('login', () => {
    it('rejects when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'a@b.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when user is not active', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.SUSPENDED,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when password is invalid', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(false);
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns token pair on success', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(true);
      setupTokenMocks();

      const result = await service.login({
        email: 'a@b.com',
        password: 'SecurePass1',
      });

      expect(result.accessToken).toBe('access-token');
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          email: 'a@b.com',
          roles: ['user'],
        }),
        expect.any(Object),
      );
    });
  });

  describe('refresh', () => {
    it('rejects invalid refresh JWT', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid'));
      await expect(
        service.refresh({ refreshToken: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when stored token not found', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(
        service.refresh({ refreshToken: 'token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates refresh token and issues new pair', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(activeUser);
      setupTokenMocks();

      const result = await service.refresh({ refreshToken: 'token' });

      expect(result.accessToken).toBe('access-token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('rejects when user is inactive after refresh', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt-1' });
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.SUSPENDED,
      });

      await expect(
        service.refresh({ refreshToken: 'token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('returns success even when refresh token is invalid', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('invalid'));
      const result = await service.logout({ refreshToken: 'bad' });
      expect(result).toEqual({ success: true });
    });

    it('revokes refresh token and blacklists access jti', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      redis.setex.mockResolvedValue('OK');

      const result = await service.logout(
        { refreshToken: 'refresh-token' },
        'access-jti',
      );

      expect(result).toEqual({ success: true });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalledWith(
        redisKeys.accessBlacklist('access-jti'),
        900,
        '1',
      );
    });
  });

  describe('getMe', () => {
    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('missing')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('returns user profile with roles and permissions', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      rbac.getUserRoles.mockResolvedValue(['user']);
      rbac.getUserPermissions.mockResolvedValue([PERMISSIONS.USERS_READ]);

      const result = await service.getMe('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'a@b.com',
        status: UserStatus.ACTIVE,
        roles: ['user'],
        permissions: [PERMISSIONS.USERS_READ],
      });
    });
  });

  describe('isAccessTokenBlacklisted', () => {
    it('delegates to redis exists', async () => {
      redis.exists.mockResolvedValue(true);
      await expect(service.isAccessTokenBlacklisted('jti-1')).resolves.toBe(
        true,
      );
      expect(redis.exists).toHaveBeenCalledWith(
        redisKeys.accessBlacklist('jti-1'),
      );
    });

    it('returns true when redis is unavailable (fail closed)', async () => {
      redis.exists.mockRejectedValue(new Error('redis down'));
      await expect(service.isAccessTokenBlacklisted('jti-1')).resolves.toBe(
        true,
      );
    });
  });
});
