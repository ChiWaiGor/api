-- CreateEnum
CREATE TYPE "RbacAuditAction" AS ENUM ('ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'ROLE_ASSIGNED', 'ROLE_UNASSIGNED', 'PERMISSION_ATTACHED', 'PERMISSION_DETACHED');

-- CreateTable
CREATE TABLE "RbacAuditLog" (
    "id" TEXT NOT NULL,
    "action" "RbacAuditAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetRoleId" TEXT,
    "targetPermissionId" TEXT,
    "metadata" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RbacAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RbacAuditLog_actorId_idx" ON "RbacAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_targetRoleId_idx" ON "RbacAuditLog"("targetRoleId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_targetUserId_idx" ON "RbacAuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "RbacAuditLog_createdAt_idx" ON "RbacAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "RbacAuditLog_action_idx" ON "RbacAuditLog"("action");
