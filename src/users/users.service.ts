import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { AuthCryptoService } from '../auth/auth-crypto.service';
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
    private readonly rbac: RbacService,
  ) {}

  async findAll(query: ListUsersQuery) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where = search
      ? { email: { contains: search, mode: 'insensitive' as const } }
      : {};

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
    if (!user) throw new NotFoundException('User not found');
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
    const canWriteAll = requesterPermissions.includes(PERMISSIONS.USERS_WRITE);
    if (id !== requesterId && !canWriteAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (body.email && body.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: body.email },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        email: body.email,
        status: body.status as UserStatus | undefined,
        passwordHash: body.password
          ? await this.crypto.hash(body.password)
          : undefined,
      },
      include: { roles: { include: { role: true } } },
    });

    if (body.password) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.rbac.invalidateUserPermissionCache(id);
    return this.toResponse(updated);
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
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
