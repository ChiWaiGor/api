import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailVerifiedGuard } from './email-verified.guard';

describe('EmailVerifiedGuard', () => {
  let guard: EmailVerifiedGuard;

  const reflector = { getAllAndOverride: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerifiedGuard,
        { provide: Reflector, useValue: reflector },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(EmailVerifiedGuard);
    jest.clearAllMocks();
  });

  const createContext = (user?: { sub: string }) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  it('allows routes that do not require verification', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a verified user', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      deletedAt: null,
    });
    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('forbids an unverified user', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: null,
      deletedAt: null,
    });
    await expect(
      guard.canActivate(createContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns false when there is no authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(createContext())).resolves.toBe(false);
  });
});
