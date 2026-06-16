import { RbacAuditAction } from '@prisma/client';

export type RbacAuditContext = {
  actorId: string;
  actorEmail: string;
  requestId?: string;
  ipAddress?: string;
};

export type RbacAuditEntry = {
  action: RbacAuditAction;
  context: RbacAuditContext;
  targetUserId?: string;
  targetRoleId?: string;
  targetPermissionId?: string;
  metadata?: Record<string, unknown>;
};
