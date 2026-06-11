import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_UNVERIFIED_EMAIL_KEY } from '../decorators/allow-unverified-email.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
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

  const mockMetadata = (options: {
    isPublic?: boolean;
    allowUnverified?: boolean;
  }) => {
    reflector.getAllAndOverride.mockImplementation(
      (key: string, _targets: unknown[]) => {
        if (key === IS_PUBLIC_KEY) return options.isPublic;
        if (key === ALLOW_UNVERIFIED_EMAIL_KEY) return options.allowUnverified;
        return undefined;
      },
    );
  };

  it('allows public routes without checking verification', async () => {
    mockMetadata({ isPublic: true });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows routes opted out via AllowUnverifiedEmail', async () => {
    mockMetadata({ allowUnverified: true });

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('skips verification when there is no authenticated user', async () => {
    mockMetadata({});

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a verified user on protected routes', async () => {
    mockMetadata({});
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      deletedAt: null,
    });

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('forbids an unverified user on protected routes', async () => {
    mockMetadata({});
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: null,
      deletedAt: null,
    });

    await expect(
      guard.canActivate(createContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a soft-deleted user on protected routes', async () => {
    mockMetadata({});
    prisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      deletedAt: new Date(),
    });

    await expect(
      guard.canActivate(createContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
