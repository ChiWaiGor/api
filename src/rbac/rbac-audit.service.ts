import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RbacAuditEntry } from './rbac-audit.types';

@Injectable()
export class RbacAuditService {
  private readonly logger = new Logger(RbacAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: RbacAuditEntry): Promise<void> {
    const {
      action,
      context,
      targetUserId,
      targetRoleId,
      targetPermissionId,
      metadata,
    } = entry;

    const payload = {
      action,
      actorId: context.actorId,
      actorEmail: context.actorEmail,
      targetUserId,
      targetRoleId,
      targetPermissionId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
    };

    try {
      await this.prisma.rbacAuditLog.create({ data: payload });
    } catch (error) {
      this.logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          audit: { action, actorId: context.actorId },
        },
        'Failed to persist RBAC audit log',
      );
    }

    this.logger.log({
      msg: 'rbac.audit',
      action,
      actorId: context.actorId,
      actorEmail: context.actorEmail,
      targetUserId,
      targetRoleId,
      targetPermissionId,
      metadata,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
    });
  }
}
