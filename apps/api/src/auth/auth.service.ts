import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { redisKeys } from '../common/constants/redis-keys';
import { MailQueueService } from '@app/queue';
import {
  Env,
  PrismaService,
  RedisService,
  recordAccountLockout,
  recordLoginAttempt,
  recordPasswordResetRequest,
  recordRefreshAttempt,
} from '@app/shared';
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
    private readonly mailQueue: MailQueueService,
  ) {}

  async register(body: RegisterBody) {
    // Hash before the existence check so response timing does not reveal
    // whether the email is already registered.
    const passwordHash = await this.crypto.hash(body.password);

    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) {
      // Uniform response to prevent email enumeration; notify the account
      // owner instead of leaking registration state to the caller.
      if (!existing.deletedAt) {
        await this.mailQueue.enqueueSend({
          to: existing.email,
          subject: 'You already have an account',
          text: 'Someone tried to register with this email address. If this was you, log in with your existing password or use the password reset flow.',
        });
      }
      return { success: true };
    }

    const userRole = await this.prisma.role.findUnique({
      where: { name: 'user' },
    });

    let user: { id: string; email: string };
    try {
      user = await this.prisma.user.create({
        data: {
          email: body.email,
          passwordHash,
          roles: userRole ? { create: [{ roleId: userRole.id }] } : undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Concurrent duplicate registration — same uniform response.
        return { success: true };
      }
      throw error;
    }

    await this.sendVerificationEmail(user);

    return { success: true };
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
      recordLoginAttempt('invalid_credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.LOCKED) {
      recordLoginAttempt('locked');
      throw new UnauthorizedException(
        'Account is locked due to too many failed login attempts. Reset your password to regain access.',
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      recordLoginAttempt('inactive');
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.crypto.verify(user.passwordHash, body.password);
    if (!valid) {
      await this.registerFailedLogin(body.email, user.id);
      recordLoginAttempt('invalid_credentials');
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.clearFailedLogins(body.email, user.id);
    recordLoginAttempt('success');

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
      recordRefreshAttempt('invalid');
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
      recordRefreshAttempt('invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Reuse detected: a token that was already rotated is being presented
      // again. Revoke the entire token family and force a fresh login.
      await this.revokeTokenFamily(stored.familyId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoked token family ${stored.familyId}`,
      );
      recordRefreshAttempt('reuse_detected');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (
      stored.expiresAt &&
      new Date(stored.expiresAt).getTime() <= Date.now()
    ) {
      recordRefreshAttempt('invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Atomic conditional revoke: only one concurrent request can rotate a
    // given token. A lost race means the token was just used elsewhere, which
    // is indistinguishable from replay — revoke the whole family.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) {
      await this.revokeTokenFamily(stored.familyId);
      this.logger.warn(
        `Concurrent refresh detected for user ${stored.userId}; revoked token family ${stored.familyId}`,
      );
      recordRefreshAttempt('reuse_detected');
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });

    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      recordRefreshAttempt('invalid');
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.roles.map((r) => r.role.name),
      stored.familyId,
    );
    recordRefreshAttempt('success');
    return tokens;
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
      await this.blacklistAccessToken(accessJti);
    }

    return { success: true };
  }

  async listSessions(userId: string, currentRefreshToken?: string) {
    const currentFamilyId = await this.resolveSessionFamilyId(
      userId,
      currentRefreshToken,
    );
    const now = new Date();

    const activeFamilies = await this.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      _min: { createdAt: true },
      _max: { expiresAt: true },
    });

    const sessionStarts = (
      await Promise.all(
        activeFamilies.map(async (family) => {
          const first = await this.prisma.refreshToken.findFirst({
            where: { userId, familyId: family.familyId },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          });
          const createdAt = first?.createdAt ?? family._min.createdAt;
          const expiresAt = family._max.expiresAt;
          if (!createdAt || !expiresAt) {
            return null;
          }
          return {
            familyId: family.familyId,
            createdAt,
            expiresAt,
          };
        }),
      )
    ).filter(
      (session): session is NonNullable<typeof session> => session !== null,
    );

    return {
      sessions: sessionStarts
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((session) => ({
          id: session.familyId,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isCurrent: session.familyId === currentFamilyId,
        })),
    };
  }

  async revokeAllSessions(
    userId: string,
    options: {
      exceptCurrent?: boolean;
      currentRefreshToken?: string;
      accessJti?: string;
    },
  ) {
    const currentFamilyId = options.exceptCurrent
      ? await this.resolveSessionFamilyId(userId, options.currentRefreshToken)
      : undefined;

    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentFamilyId ? { familyId: { not: currentFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    if (!options.exceptCurrent && options.accessJti) {
      await this.blacklistAccessToken(options.accessJti);
    }

    return { success: true as const, revokedCount: result.count };
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    options?: { accessJti?: string; currentRefreshToken?: string },
  ) {
    const currentFamilyId = await this.resolveSessionFamilyId(
      userId,
      options?.currentRefreshToken,
    );
    const isCurrentSession = currentFamilyId === sessionId;

    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        familyId: sessionId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new UnauthorizedException('Session not found');
    }

    if (isCurrentSession && options?.accessJti) {
      await this.blacklistAccessToken(options.accessJti);
    }

    return { success: true as const };
  }

  async resolveSessionFamilyId(
    userId: string,
    refreshToken?: string,
  ): Promise<string | undefined> {
    if (!refreshToken) {
      return undefined;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtRefreshPayload>(
        refreshToken,
        {
          secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
          ignoreExpiration: true,
        },
      );

      if (payload.sub !== userId) {
        return undefined;
      }

      const stored = await this.prisma.refreshToken.findFirst({
        where: { id: payload.tokenId, userId },
        select: { familyId: true },
      });

      return stored?.familyId;
    } catch {
      return undefined;
    }
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
      recordPasswordResetRequest();
      const { token, tokenHash } = this.generateSecret();
      const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', {
        infer: true,
      });

      // Invalidate prior unused reset tokens so only the latest link works.
      await this.prisma.$transaction([
        this.prisma.passwordResetToken.deleteMany({
          where: { userId: user.id, usedAt: null },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
          },
        }),
      ]);

      const link = this.buildLink('/reset-password', token);
      await this.mailQueue.enqueueSend({
        to: user.email,
        subject: 'Reset your password',
        text: `Use the following link to reset your password (valid for ${ttlMinutes} minutes):\n${link}`,
      });
    }

    return { success: true };
  }

  async changePassword(
    userId: string,
    body: ChangePasswordBody,
    accessJti?: string,
  ) {
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

    // Revoke the current access token too — a credential change must not
    // leave any previously issued token usable.
    if (accessJti) {
      await this.blacklistAccessToken(accessJti);
    }

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

    await this.prisma.$transaction(async (tx) => {
      // Atomically claim the single-use token; a concurrent confirm with the
      // same token loses the race and is rejected.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Invalid or expired reset token');
      }
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // A successful reset clears a lockout so the user regains access.
          status: UserStatus.ACTIVE,
        },
      });
      // Invalidate every existing refresh token on credential change.
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

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

    await this.prisma.$transaction(async (tx) => {
      // Atomically claim the single-use token (see confirmPasswordReset).
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException(
          'Invalid or expired verification token',
        );
      }
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
    });

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

  private async blacklistAccessToken(jti: string): Promise<void> {
    const ttlSeconds = this.parseTtlToSeconds(
      this.config.get('JWT_ACCESS_TTL', { infer: true }),
    );
    await this.redis.setex(redisKeys.accessBlacklist(jti), ttlSeconds, '1');
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
      // Redis unavailable — fall back to a DB-backed counter so brute-force
      // lockout never fails open. Unknown emails have no user row to count
      // against (and cannot be locked anyway).
      if (!userId) {
        return;
      }
      try {
        count = await this.incrementFailedLoginsInDb(userId, windowSeconds);
      } catch {
        // Both stores unavailable; do not block the (already failing) login
        // path on bookkeeping.
        return;
      }
    }

    if (userId && count >= max) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.LOCKED },
      });
      await this.invalidateUserSessionStateCache(userId);
      recordAccountLockout();
      this.logger.warn(
        `User ${userId} locked after ${count} failed login attempts`,
      );
    }
  }

  /**
   * Atomic UPDATE ... RETURNING that resets the counter when the lockout
   * window has elapsed, otherwise increments it. Used only when Redis is
   * unavailable so lockout does not fail open.
   */
  private async incrementFailedLoginsInDb(
    userId: string,
    windowSeconds: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ failedLoginCount: number }[]>`
      UPDATE "User"
      SET
        "failedLoginCount" = CASE
          WHEN "failedLoginWindowStartedAt" IS NULL
            OR "failedLoginWindowStartedAt" <= now() - make_interval(secs => ${windowSeconds})
          THEN 1
          ELSE "failedLoginCount" + 1
        END,
        "failedLoginWindowStartedAt" = CASE
          WHEN "failedLoginWindowStartedAt" IS NULL
            OR "failedLoginWindowStartedAt" <= now() - make_interval(secs => ${windowSeconds})
          THEN now()
          ELSE "failedLoginWindowStartedAt"
        END
      WHERE "id" = ${userId}
      RETURNING "failedLoginCount"
    `;
    return rows[0]?.failedLoginCount ?? 0;
  }

  private async clearFailedLogins(
    email: string,
    userId?: string,
  ): Promise<void> {
    try {
      await this.redis.del(redisKeys.failedLogins(email));
    } catch {
      // Best-effort reset of the failed-login counter.
    }
    if (userId) {
      try {
        await this.prisma.user.updateMany({
          where: { id: userId, failedLoginCount: { gt: 0 } },
          data: { failedLoginCount: 0, failedLoginWindowStartedAt: null },
        });
      } catch {
        // Best-effort reset of the DB fallback counter.
      }
    }
  }

  private async clearFailedLoginsForUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user) {
      await this.clearFailedLogins(user.email, userId);
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
    await this.mailQueue.enqueueSend({
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
