import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { redisKeys } from '../common/constants/redis-keys';
import { Env } from '../config/env.schema';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthCryptoService } from './auth-crypto.service';
import type {
  ChangePasswordBody,
  EmailVerificationConfirmBody,
  LoginBody,
  LogoutBody,
  PasswordResetConfirmBody,
  PasswordResetRequestBody,
  RefreshBody,
  RegisterBody,
} from './auth.schema';
import { JwtPayload, JwtRefreshPayload } from './types/jwt-payload.type';
import {
  toUserSessionState,
  type UserSessionState,
} from './types/user-session-state.type';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    private readonly rbac: RbacService,
    private readonly mail: MailService,
  ) {}

  async register(body: RegisterBody) {
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) {
      throw new ConflictException('Unable to complete registration');
    }

    const passwordHash = await this.crypto.hash(body.password);
    const userRole = await this.prisma.role.findUnique({
      where: { name: 'user' },
    });

    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        roles: userRole ? { create: [{ roleId: userRole.id }] } : undefined,
      },
      include: { roles: { include: { role: true } } },
    });

    await this.sendVerificationEmail(user);

    return this.issueTokenPair(user.id, user.email);
  }

  async login(body: LoginBody) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: { roles: { include: { role: true } } },
    });

    if (!user || user.deletedAt) {
      // Count failed attempts even for unknown emails to slow enumeration and
      // credential stuffing, then return a generic error.
      await this.registerFailedLogin(body.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException(
        'Account is locked due to too many failed login attempts. Reset your password to regain access.',
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.crypto.verify(user.passwordHash, body.password);
    if (!valid) {
      await this.registerFailedLogin(body.email, user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.clearFailedLogins(body.email);

    return this.issueTokenPair(
      user.id,
      user.email,
      user.roles.map((r) => r.role.name),
    );
  }

  async refresh(body: RefreshBody) {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(
        body.refreshToken,
        {
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(body.refreshToken);
    // Look the token up regardless of revocation so we can detect replay of an
    // already-rotated (revoked) token.
    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        id: payload.tokenId,
        userId: payload.sub,
        tokenHash,
      },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse detected: a token that was already rotated is being presented
      // again. Revoke the entire token family and force a fresh login.
      await this.revokeTokenFamily(stored.familyId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoked token family ${stored.familyId}`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (
      stored.expiresAt &&
      new Date(stored.expiresAt).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });

    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokenPair(
      user.id,
      user.email,
      user.roles.map((r) => r.role.name),
      stored.familyId,
    );
  }

  async logout(body: LogoutBody, accessJti?: string) {
    try {
      const refreshPayload = await this.jwt.verifyAsync<JwtRefreshPayload>(
        body.refreshToken,
        {
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          ignoreExpiration: true,
        },
      );

      const tokenHash = this.hashToken(body.refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: {
          id: refreshPayload.tokenId,
          userId: refreshPayload.sub,
          tokenHash,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    } catch {
      // ignore invalid refresh on logout
    }

    if (accessJti) {
      const ttlSeconds = this.parseTtlToSeconds(
        this.config.get('JWT_ACCESS_TTL', { infer: true }),
      );
      await this.redis.setex(
        redisKeys.accessBlacklist(accessJti),
        ttlSeconds,
        '1',
      );
    }

    return { success: true };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();

    const [roles, permissions] = await Promise.all([
      this.rbac.getUserRoles(userId),
      this.rbac.getUserPermissions(userId),
    ]);

    return {
      id: user.id,
      email: user.email,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      roles,
      permissions,
    };
  }

  async requestPasswordReset(body: PasswordResetRequestBody) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });

    // Always respond identically to avoid leaking which emails are registered.
    if (user && !user.deletedAt) {
      const { token, tokenHash } = this.generateSecret();
      const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', {
        infer: true,
      });

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        },
      });

      const link = this.buildLink('/reset-password', token);
      await this.mail.send({
        to: user.email,
        subject: 'Reset your password',
        text: `Use the following link to reset your password (valid for ${ttlMinutes} minutes):\n${link}`,
      });
    }

    return { success: true };
  }

  async changePassword(userId: string, body: ChangePasswordBody) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }

    const valid = await this.crypto.verify(
      user.passwordHash,
      body.currentPassword,
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid current password');
    }

    const passwordHash = await this.crypto.hash(body.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  async confirmPasswordReset(body: PasswordResetConfirmBody) {
    const tokenHash = this.hashToken(body.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await this.crypto.hash(body.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // A successful reset clears a lockout so the user regains access.
          status: UserStatus.ACTIVE,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate every existing refresh token on credential change.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.clearFailedLoginsForUser(record.userId);
    await this.invalidateUserSessionStateCache(record.userId);

    return { success: true };
  }

  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }

    if (user.emailVerifiedAt) {
      return { success: true };
    }

    await this.sendVerificationEmail(user);

    return { success: true };
  }

  async confirmEmailVerification(body: EmailVerificationConfirmBody) {
    const tokenHash = this.hashToken(body.token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.invalidateUserSessionStateCache(record.userId);

    return { success: true };
  }

  async getUserSessionState(userId: string): Promise<UserSessionState> {
    const cacheKey = redisKeys.userSessionState(userId);
    let cached: UserSessionState | null = null;

    try {
      cached = await this.redis.getJson<UserSessionState>(cacheKey);
    } catch {
      // Redis unavailable — fall back to DB.
    }

    if (cached) {
      return cached;
    }

    const state = await this.loadUserSessionStateFromDb(userId);
    if (!state) {
      throw new UnauthorizedException();
    }

    try {
      await this.redis.setJson(cacheKey, state, this.sessionStateCacheTtl);
    } catch {
      // Best-effort cache write; state already loaded from DB.
    }

    return state;
  }

  async invalidateUserSessionStateCache(userId: string): Promise<void> {
    try {
      await this.redis.del(redisKeys.userSessionState(userId));
    } catch {
      // Best-effort cache invalidation.
    }
  }

  assertActiveSession(state: UserSessionState): void {
    if (state.deletedAt) {
      throw new UnauthorizedException('Account is no longer available');
    }
    if (state.status === UserStatus.LOCKED) {
      throw new UnauthorizedException(
        'Account is locked due to too many failed login attempts. Reset your password to regain access.',
      );
    }
    if (state.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }
  }

  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    try {
      return await this.redis.exists(redisKeys.accessBlacklist(jti));
    } catch {
      // Fail closed: deny access when Redis cannot confirm token status.
      return true;
    }
  }

  private get sessionStateCacheTtl(): number {
    return this.config.get('SESSION_STATE_CACHE_TTL_SECONDS', { infer: true });
  }

  private async loadUserSessionStateFromDb(
    userId: string,
  ): Promise<UserSessionState | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, emailVerifiedAt: true, deletedAt: true },
    });
    if (!user) {
      return null;
    }
    return toUserSessionState(user);
  }

  private async issueTokenPair(
    userId: string,
    email: string,
    roles?: string[],
    familyId?: string,
  ) {
    const resolvedRoles = roles ?? (await this.rbac.getUserRoles(userId));
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const resolvedFamilyId = familyId ?? randomUUID();

    const refreshRecord = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: resolvedFamilyId,
        tokenHash: '',
        expiresAt: new Date(
          Date.now() +
            this.parseTtlToSeconds(
              this.config.get('JWT_REFRESH_TTL', { infer: true }),
            ) *
              1000,
        ),
      },
    });

    const accessPayload: JwtPayload = {
      sub: userId,
      email,
      roles: resolvedRoles,
      jti: accessJti,
    };

    const refreshPayload: JwtRefreshPayload = {
      sub: userId,
      tokenId: refreshRecord.id,
      jti: refreshJti,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
      }),
    ]);

    await this.prisma.refreshToken.update({
      where: { id: refreshRecord.id },
      data: { tokenHash: this.hashToken(refreshToken) },
    });

    return { accessToken, refreshToken };
  }

  private async revokeTokenFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async registerFailedLogin(
    email: string,
    userId?: string,
  ): Promise<void> {
    const max = this.config.get('LOGIN_MAX_FAILED_ATTEMPTS', { infer: true });
    const windowSeconds = this.config.get('LOGIN_LOCKOUT_WINDOW_SECONDS', {
      infer: true,
    });

    let count: number;
    try {
      count = await this.redis.incrWithTtl(
        redisKeys.failedLogins(email),
        windowSeconds,
      );
    } catch {
      // Without Redis we cannot reliably count attempts; skip lockout
      // bookkeeping rather than block the (already failing) login path.
      return;
    }

    if (userId && count >= max) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.LOCKED },
      });
      await this.invalidateUserSessionStateCache(userId);
      this.logger.warn(
        `User ${userId} locked after ${count} failed login attempts`,
      );
    }
  }

  private async clearFailedLogins(email: string): Promise<void> {
    try {
      await this.redis.del(redisKeys.failedLogins(email));
    } catch {
      // Best-effort reset of the failed-login counter.
    }
  }

  private async clearFailedLoginsForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user) {
      await this.clearFailedLogins(user.email);
    }
  }

  private async sendVerificationEmail(user: {
    id: string;
    email: string;
  }): Promise<void> {
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const { token, tokenHash } = this.generateSecret();
    const ttlMinutes = this.config.get('EMAIL_VERIFICATION_TTL_MINUTES', {
      infer: true,
    });

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });

    const link = this.buildLink('/verify-email', token);
    await this.mail.send({
      to: user.email,
      subject: 'Verify your email address',
      text: `Confirm your email by visiting the following link (valid for ${ttlMinutes} minutes):\n${link}`,
    });
  }

  private generateSecret(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: this.hashToken(token) };
  }

  private buildLink(path: string, token: string): string {
    const base = this.config
      .get('APP_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    return `${base}${path}?token=${token}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseTtlToSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[unit] ?? 60);
  }
}
