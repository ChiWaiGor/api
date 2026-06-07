import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RbacAuditAction, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../common/constants/redis-keys';
import { Env } from '../config/env.schema';
import { RbacAuditService } from './rbac-audit.service';
import type { RbacAuditContext } from './rbac-audit.types';
import { ALL_PERMISSIONS, ALL_PERMISSIONS_SET } from './permissions.constants';
import {
  isProtectedPermissionForRole,
  isReservedRoleName,
} from './roles.constants';
import type {
  AssignRoleBody,
  AttachPermissionBody,
  CreateRoleBody,
  UpdateRoleBody,
} from './rbac.schema';

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: RbacAuditService,
  ) {}

  private get cacheTtl(): number {
    return this.config.get('PERMISSION_CACHE_TTL_SECONDS', { infer: true });
  }

  async invalidateUserPermissionCache(userId: string): Promise<void> {
    await this.redis.del(redisKeys.permissionCache(userId));
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return rows.map((r) => r.role.name);
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const cacheKey = redisKeys.permissionCache(userId);
    let cached: string[] | null = null;

    try {
      cached = await this.redis.getJson<string[]>(cacheKey);
    } catch {
      // Redis unavailable — fall back to DB rather than fail open on permissions.
    }

    if (cached) {
      return cached;
    }

    const permissions = await this.loadUserPermissionsFromDb(userId);

    try {
      await this.redis.setJson(cacheKey, permissions, this.cacheTtl);
    } catch {
      // Best-effort cache write; permissions already loaded from DB.
    }

    return permissions;
  }

  private async loadUserPermissionsFromDb(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const set = new Set<string>();
    for (const userRole of rows) {
      for (const rp of userRole.role.permissions) {
        set.add(rp.permission.action);
      }
    }
    return [...set].sort();
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      where: { action: { in: [...ALL_PERMISSIONS] } },
      orderBy: { action: 'asc' },
    });
  }

  async createRole(body: CreateRoleBody, auditContext: RbacAuditContext) {
    if (isReservedRoleName(body.name)) {
      throw new BadRequestException('Role name is reserved');
    }

    let role: Role;
    try {
      role = await this.prisma.role.create({
        data: {
          name: body.name,
          description: body.description,
        },
      });
    } catch {
      throw new ConflictException('Role already exists');
    }

    await this.audit.record({
      action: RbacAuditAction.ROLE_CREATED,
      context: auditContext,
      targetRoleId: role.id,
      metadata: { roleName: role.name, description: role.description },
    });

    return role;
  }

  async updateRole(
    roleId: string,
    body: UpdateRoleBody,
    auditContext: RbacAuditContext,
  ) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertRoleIsMutable(role);

    if (body.name !== undefined) {
      if (isReservedRoleName(body.name)) {
        throw new BadRequestException('Role name is reserved');
      }
    }

    let updated: Role;
    try {
      updated = await this.prisma.role.update({
        where: { id: roleId },
        data: {
          name: body.name,
          description: body.description,
        },
      });
    } catch {
      throw new ConflictException('Role name already exists');
    }

    await this.audit.record({
      action: RbacAuditAction.ROLE_UPDATED,
      context: auditContext,
      targetRoleId: roleId,
      metadata: {
        before: { name: role.name, description: role.description },
        after: { name: updated.name, description: updated.description },
      },
    });

    return updated;
  }

  async deleteRole(roleId: string, auditContext: RbacAuditContext) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertRoleIsMutable(role);

    const assignmentCount = await this.prisma.userRole.count({
      where: { roleId },
    });
    if (assignmentCount > 0) {
      throw new ConflictException('Role is assigned to users');
    }

    await this.prisma.role.delete({ where: { id: roleId } });

    await this.audit.record({
      action: RbacAuditAction.ROLE_DELETED,
      context: auditContext,
      targetRoleId: roleId,
      metadata: { roleName: role.name, description: role.description },
    });

    return { success: true };
  }

  async assignRoleToUser(body: AssignRoleBody, auditContext: RbacAuditContext) {
    await this.ensureUserExists(body.userId);
    const role = await this.getRoleOrThrow(body.roleId);

    try {
      await this.prisma.userRole.create({
        data: { userId: body.userId, roleId: body.roleId },
      });
    } catch {
      throw new ConflictException('User already has this role');
    }

    await this.invalidateUserPermissionCache(body.userId);

    await this.audit.record({
      action: RbacAuditAction.ROLE_ASSIGNED,
      context: auditContext,
      targetUserId: body.userId,
      targetRoleId: body.roleId,
      metadata: { roleName: role.name },
    });

    return { success: true };
  }

  async attachPermissionToRole(
    body: AttachPermissionBody,
    auditContext: RbacAuditContext,
  ) {
    const role = await this.getRoleOrThrow(body.roleId);
    const permission = await this.getPermissionOrThrow(body.permissionId);
    this.assertPermissionInCatalog(permission.action);

    try {
      await this.prisma.rolePermission.create({
        data: {
          roleId: body.roleId,
          permissionId: body.permissionId,
        },
      });
    } catch {
      throw new ConflictException('Role already has this permission');
    }

    await this.invalidatePermissionCachesForRole(body.roleId);

    await this.audit.record({
      action: RbacAuditAction.PERMISSION_ATTACHED,
      context: auditContext,
      targetRoleId: body.roleId,
      targetPermissionId: body.permissionId,
      metadata: {
        roleName: role.name,
        permissionAction: permission.action,
      },
    });

    return { success: true };
  }

  async unassignRoleFromUser(
    body: AssignRoleBody,
    auditContext: RbacAuditContext,
  ) {
    await this.ensureUserExists(body.userId);
    const role = await this.getRoleOrThrow(body.roleId);
    await this.assertCanUnassignRole(role);

    try {
      await this.prisma.userRole.delete({
        where: {
          userId_roleId: {
            userId: body.userId,
            roleId: body.roleId,
          },
        },
      });
    } catch {
      throw new NotFoundException('User does not have this role');
    }

    await this.invalidateUserPermissionCache(body.userId);

    await this.audit.record({
      action: RbacAuditAction.ROLE_UNASSIGNED,
      context: auditContext,
      targetUserId: body.userId,
      targetRoleId: body.roleId,
      metadata: { roleName: role.name },
    });

    return { success: true };
  }

  async detachPermissionFromRole(
    body: AttachPermissionBody,
    auditContext: RbacAuditContext,
  ) {
    const role = await this.getRoleOrThrow(body.roleId);
    const permission = await this.getPermissionOrThrow(body.permissionId);
    this.assertCanDetachPermission(role, permission.action);

    try {
      await this.prisma.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: body.roleId,
            permissionId: body.permissionId,
          },
        },
      });
    } catch {
      throw new NotFoundException('Role does not have this permission');
    }

    await this.invalidatePermissionCachesForRole(body.roleId);

    await this.audit.record({
      action: RbacAuditAction.PERMISSION_DETACHED,
      context: auditContext,
      targetRoleId: body.roleId,
      targetPermissionId: body.permissionId,
      metadata: {
        roleName: role.name,
        permissionAction: permission.action,
      },
    });

    return { success: true };
  }

  private assertPermissionInCatalog(action: string): void {
    if (!ALL_PERMISSIONS_SET.has(action)) {
      throw new BadRequestException(
        'Permission is not defined in the application',
      );
    }
  }

  private assertRoleIsMutable(role: Role): void {
    if (role.isSystem) {
      throw new ForbiddenException(
        'System roles cannot be modified or deleted',
      );
    }
  }

  private assertCanDetachPermission(role: Role, action: string): void {
    if (!role.isSystem) {
      return;
    }
    if (isProtectedPermissionForRole(role.name, action)) {
      throw new BadRequestException(
        'Cannot detach protected permission from system role',
      );
    }
  }

  private async assertCanUnassignRole(role: Role): Promise<void> {
    if (role.name !== 'admin') {
      return;
    }

    const adminAssignmentCount = await this.prisma.userRole.count({
      where: { roleId: role.id },
    });
    if (adminAssignmentCount <= 1) {
      throw new BadRequestException('Cannot remove the last admin assignment');
    }
  }

  private async invalidatePermissionCachesForRole(roleId: string) {
    const users = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await Promise.all(
      users.map((u) => this.invalidateUserPermissionCache(u.userId)),
    );
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
  }

  private async getRoleOrThrow(roleId: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private async getPermissionOrThrow(permissionId: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    });
    if (!permission) throw new NotFoundException('Permission not found');
    return permission;
  }
}
