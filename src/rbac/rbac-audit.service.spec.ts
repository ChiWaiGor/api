import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RbacAuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacAuditService } from './rbac-audit.service';

describe('RbacAuditService', () => {
  let service: RbacAuditService;

  const prisma = {
    rbacAuditLog: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RbacAuditService);
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('persists audit log and emits structured log', async () => {
    prisma.rbacAuditLog.create.mockResolvedValue({ id: 'log-1' });

    await service.record({
      action: RbacAuditAction.ROLE_ASSIGNED,
      context: {
        actorId: 'actor-1',
        actorEmail: 'admin@example.com',
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
      },
      targetUserId: 'user-1',
      targetRoleId: 'role-1',
      metadata: { roleName: 'editor' },
    });

    expect(prisma.rbacAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: RbacAuditAction.ROLE_ASSIGNED,
        actorId: 'actor-1',
        actorEmail: 'admin@example.com',
        targetUserId: 'user-1',
        targetRoleId: 'role-1',
        metadata: { roleName: 'editor' },
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
      }),
    });
    expect(Logger.prototype.log).toHaveBeenCalled();
  });

  it('does not throw when persistence fails', async () => {
    prisma.rbacAuditLog.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.record({
        action: RbacAuditAction.ROLE_CREATED,
        context: { actorId: 'actor-1', actorEmail: 'admin@example.com' },
        targetRoleId: 'role-1',
      }),
    ).resolves.toBeUndefined();

    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalled();
  });
});
