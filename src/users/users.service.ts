import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { AuthCryptoService } from '../auth/auth-crypto.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { RbacService } from '../rbac/rbac.service';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
} from './user.schema';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
  ) {}

  async findAll(query: ListUsersQuery) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where = {
      deletedAt: null,
      ...(search
        ? { email: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { roles: { include: { role: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: users.map((u) => this.toResponse(u)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(
    id: string,
    requesterId: string,
    requesterPermissions: string[],
  ) {
    const canReadAll = requesterPermissions.includes(PERMISSIONS.USERS_READ);
    if (id !== requesterId && !canReadAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    return this.toResponse(user);
  }

  async create(body: CreateUserBody) {
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await this.crypto.hash(body.password);
    const defaultRole = await this.prisma.role.findUnique({
      where: { name: 'user' },
    });

    const roleNames = body.roleNames?.length
      ? body.roleNames
      : defaultRole
        ? ['user']
        : [];

    if (body.roleNames?.length) {
      const distinctRoleNames = [...new Set(body.roleNames)];
      const existingRoles = await this.prisma.role.findMany({
        where: { name: { in: distinctRoleNames } },
        select: { name: true },
      });
      const existingRoleNames = new Set(existingRoles.map((r) => r.name));
      const invalidRoleNames = distinctRoleNames.filter(
        (name) => !existingRoleNames.has(name),
      );

      if (invalidRoleNames.length) {
        throw new BadRequestException(
          `Invalid roleNames: ${invalidRoleNames.join(', ')}`,
        );
      }
    }

    const roles = await this.prisma.role.findMany({
      where: { name: { in: roleNames } },
    });

    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        roles: {
          create: roles.map((role) => ({ roleId: role.id })),
        },
      },
      include: { roles: { include: { role: true } } },
    });

    await this.rbac.invalidateUserPermissionCache(user.id);
    return this.toResponse(user);
  }

  async update(
    id: string,
    body: UpdateUserBody,
    requesterId: string,
    requesterPermissions: string[],
  ) {
    const isSelfUpdate = id === requesterId;
    const canWriteAll = requesterPermissions.includes(PERMISSIONS.USERS_WRITE);
    if (!isSelfUpdate && !canWriteAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    if (isSelfUpdate) {
      if (body.password !== undefined) {
        throw new BadRequestException(
          'Use POST /auth/change-password to change your password',
        );
      }
      if (body.status !== undefined) {
        throw new BadRequestException('Cannot update your own status');
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    const emailChanging = body.email !== undefined && body.email !== user.email;

    if (emailChanging) {
      const existing = await this.prisma.user.findUnique({
        where: { email: body.email },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    const data: {
      email?: string;
      status?: UserStatus;
      passwordHash?: string;
      emailVerifiedAt?: Date | null;
    } = {};

    if (body.email !== undefined) {
      data.email = body.email;
    }
    if (!isSelfUpdate && canWriteAll) {
      if (body.status !== undefined) {
        data.status = body.status;
      }
      if (body.password) {
        data.passwordHash = await this.crypto.hash(body.password);
      }
    }
    if (emailChanging) {
      data.emailVerifiedAt = null;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: { roles: { include: { role: true } } },
    });

    if (!isSelfUpdate && body.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    if (emailChanging) {
      await this.auth.requestEmailVerification(id);
    }

    await this.rbac.invalidateUserPermissionCache(id);
    return this.toResponse(updated);
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    // Soft delete: preserve the row (and its audit/FK history) while making the
    // account unusable. Auth paths reject users with a non-null deletedAt.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.rbac.invalidateUserPermissionCache(id);
    return { success: true };
  }

  private toResponse(user: {
    id: string;
    email: string;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
    roles: { role: { name: string } }[];
  }) {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles.map((r) => r.role.name),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
