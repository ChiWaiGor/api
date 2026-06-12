import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { redisKeys } from '../common/constants/redis-keys';
import { toUserSessionState } from './types/user-session-state.type';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    emailVerificationToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    role: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const crypto = { hash: jest.fn(), verify: jest.fn() };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const redis = {
    setex: jest.fn(),
    exists: jest.fn(),
    incrWithTtl: jest.fn(),
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
  const rbac = {
    getUserRoles: jest.fn(),
    getUserPermissions: jest.fn(),
    invalidateUserPermissionCache: jest.fn(),
  };
  const mail = { send: jest.fn() };

  const activeUser = {
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: 'hash',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: null,
    deletedAt: null,
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
                LOGIN_MAX_FAILED_ATTEMPTS: 5,
                LOGIN_LOCKOUT_WINDOW_SECONDS: 900,
                PASSWORD_RESET_TTL_MINUTES: 30,
                EMAIL_VERIFICATION_TTL_MINUTES: 1440,
                APP_BASE_URL: 'http://localhost:3000',
                MAIL_FROM: 'no-reply@example.com',
                MAIL_TRANSPORT: 'log',
                SESSION_STATE_CACHE_TTL_SECONDS: 300,
              };
              return map[key];
            },
          },
        },
        { provide: RedisService, useValue: redis },
        { provide: RbacService, useValue: rbac },
        { provide: MailService, useValue: mail },
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

    it('creates user, sends verification email, and returns token pair', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      crypto.hash.mockResolvedValue('hashed');
      prisma.role.findUnique.mockResolvedValue({ id: 'role-user' });
      prisma.user.create.mockResolvedValue(activeUser);
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-1' });
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
      expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@b.com',
          subject: 'Verify your email address',
        }),
      );
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
        status: UserStatus.INACTIVE,
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
        status: UserStatus.INACTIVE,
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
        emailVerified: false,
        roles: ['user'],
        permissions: [PERMISSIONS.USERS_READ],
      });
    });

    it('reports emailVerified true when verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        emailVerifiedAt: new Date(),
      });
      rbac.getUserRoles.mockResolvedValue(['user']);
      rbac.getUserPermissions.mockResolvedValue([]);

      const result = await service.getMe('user-1');
      expect(result.emailVerified).toBe(true);
    });
  });

  describe('getUserSessionState', () => {
    it('returns cached session state when present', async () => {
      const cached = toUserSessionState(activeUser);
      redis.getJson.mockResolvedValue(cached);

      await expect(service.getUserSessionState('user-1')).resolves.toEqual(
        cached,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('loads from DB and caches on miss', async () => {
      redis.getJson.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        status: activeUser.status,
        emailVerifiedAt: activeUser.emailVerifiedAt,
        deletedAt: activeUser.deletedAt,
      });

      const result = await service.getUserSessionState('user-1');

      expect(result).toEqual(toUserSessionState(activeUser));
      expect(redis.setJson).toHaveBeenCalledWith(
        redisKeys.userSessionState('user-1'),
        toUserSessionState(activeUser),
        300,
      );
    });

    it('throws when user is not found', async () => {
      redis.getJson.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getUserSessionState('missing'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('assertActiveSession', () => {
    it('rejects deleted users', () => {
      expect(() =>
        service.assertActiveSession(
          toUserSessionState({ ...activeUser, deletedAt: new Date() }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects locked users', () => {
      expect(() =>
        service.assertActiveSession(
          toUserSessionState({ ...activeUser, status: UserStatus.LOCKED }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects inactive users', () => {
      expect(() =>
        service.assertActiveSession(
          toUserSessionState({ ...activeUser, status: UserStatus.INACTIVE }),
        ),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('invalidateUserSessionStateCache', () => {
    it('deletes the redis cache key', async () => {
      await service.invalidateUserSessionStateCache('user-1');
      expect(redis.del).toHaveBeenCalledWith(
        redisKeys.userSessionState('user-1'),
      );
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

  describe('refresh token reuse detection', () => {
    it('revokes the token family when a revoked token is replayed', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        revokedAt: new Date(),
      });

      await expect(
        service.refresh({ refreshToken: 'token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: 'fam-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('preserves the family id when rotating an active token', async () => {
      jwt.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        tokenId: 'rt-1',
        jti: 'jti',
      });
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue(activeUser);
      setupTokenMocks();

      await service.refresh({ refreshToken: 'token' });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ familyId: 'fam-1' }),
        }),
      );
    });
  });

  describe('account lockout', () => {
    it('locks the account after reaching the failed-attempt threshold', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(false);
      redis.incrWithTtl.mockResolvedValue(5);

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { status: UserStatus.LOCKED },
        }),
      );
    });

    it('does not lock before reaching the threshold', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(false);
      redis.incrWithTtl.mockResolvedValue(2);

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects login for a locked account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.LOCKED,
      });

      await expect(
        service.login({ email: 'a@b.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(crypto.verify).not.toHaveBeenCalled();
    });

    it('clears the failed-login counter on success', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(true);
      setupTokenMocks();

      await service.login({ email: 'a@b.com', password: 'right' });

      expect(redis.del).toHaveBeenCalledWith(redisKeys.failedLogins('a@b.com'));
    });
  });

  describe('soft-deleted users', () => {
    it('rejects login for a soft-deleted user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        deletedAt: new Date(),
      });

      await expect(
        service.login({ email: 'a@b.com', password: 'right' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('rejects when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('missing', {
          currentPassword: 'old',
          newPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects invalid current password', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'wrong',
          newPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('updates password and revokes refresh tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      crypto.verify.mockResolvedValue(true);
      crypto.hash.mockResolvedValue('new-hash');

      const result = await service.changePassword('user-1', {
        currentPassword: 'old',
        newPassword: 'NewPass123',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('password reset', () => {
    it('returns success without sending mail for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.requestPasswordReset({ email: 'x@y.com' });

      expect(result).toEqual({ success: true });
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('creates a token and sends mail for a known user', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'prt-1' });

      const result = await service.requestPasswordReset({ email: 'a@b.com' });

      expect(result).toEqual({ success: true });
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@b.com' }),
      );
    });

    it('rejects an invalid or expired reset token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmPasswordReset({
          token: 'bad',
          newPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('resets the password and revokes refresh tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      crypto.hash.mockResolvedValue('new-hash');
      prisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' });

      const result = await service.confirmPasswordReset({
        token: 'good',
        newPassword: 'NewPass123',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('email verification', () => {
    it('is a no-op when the email is already verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        emailVerifiedAt: new Date(),
      });

      const result = await service.requestEmailVerification('user-1');

      expect(result).toEqual({ success: true });
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('creates a token and sends mail when unverified', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-1' });

      const result = await service.requestEmailVerification('user-1');

      expect(result).toEqual({ success: true });
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
      expect(mail.send).toHaveBeenCalled();
    });

    it('marks the email verified on confirm', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.confirmEmailVerification({ token: 'good' });

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an invalid verification token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmEmailVerification({ token: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
