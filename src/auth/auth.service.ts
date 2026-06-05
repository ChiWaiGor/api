import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { redisKeys } from '../common/constants/redis-keys';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthCryptoService } from './auth-crypto.service';
import type {
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
} from './auth.schema';
import { JwtPayload, JwtRefreshPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    private readonly rbac: RbacService,
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
        roles: userRole
          ? { create: [{ roleId: userRole.id }] }
          : undefined,
      },
      include: { roles: { include: { role: true } } },
    });

    return this.issueTokenPair(user.id, user.email);
  }

  async login(body: LoginBody) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: { roles: { include: { role: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.crypto.verify(user.passwordHash, body.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokenPair(
      user.id,
      user.email,
      user.roles.map((r) => r.role.name),
    );
  }

  async refresh(body: RefreshBody) {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(body.refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(body.refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        id: payload.tokenId,
        userId: payload.sub,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) {
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

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokenPair(
      user.id,
      user.email,
      user.roles.map((r) => r.role.name),
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
    if (!user) throw new UnauthorizedException();

    const [roles, permissions] = await Promise.all([
      this.rbac.getUserRoles(userId),
      this.rbac.getUserPermissions(userId),
    ]);

    return {
      id: user.id,
      email: user.email,
      status: user.status,
      roles,
      permissions,
    };
  }

  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    try {
      return await this.redis.exists(redisKeys.accessBlacklist(jti));
    } catch {
      // Fail closed: deny access when Redis cannot confirm token status.
      return true;
    }
  }

  private async issueTokenPair(
    userId: string,
    email: string,
    roles?: string[],
  ) {
    const resolvedRoles =
      roles ?? (await this.rbac.getUserRoles(userId));
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const refreshRecord = await this.prisma.refreshToken.create({
      data: {
        userId,
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
