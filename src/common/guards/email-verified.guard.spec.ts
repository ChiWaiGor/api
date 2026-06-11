import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../auth/auth.service';
import { ALLOW_UNVERIFIED_EMAIL_KEY } from '../decorators/allow-unverified-email.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { EmailVerifiedGuard } from './email-verified.guard';

describe('EmailVerifiedGuard', () => {
  let guard: EmailVerifiedGuard;

  const reflector = { getAllAndOverride: jest.fn() };
  const authService = { getUserSessionState: jest.fn() };

  const verifiedSession = {
    status: UserStatus.ACTIVE,
    emailVerifiedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
  };

  const unverifiedSession = {
    status: UserStatus.ACTIVE,
    emailVerifiedAt: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerifiedGuard,
        { provide: Reflector, useValue: reflector },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    guard = module.get(EmailVerifiedGuard);
    jest.clearAllMocks();
  });

  const createContext = (user?: { sub: string; sessionState?: unknown }) =>
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
    expect(authService.getUserSessionState).not.toHaveBeenCalled();
  });

  it('allows routes opted out via AllowUnverifiedEmail', async () => {
    mockMetadata({ allowUnverified: true });

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
    expect(authService.getUserSessionState).not.toHaveBeenCalled();
  });

  it('skips verification when there is no authenticated user', async () => {
    mockMetadata({});

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(authService.getUserSessionState).not.toHaveBeenCalled();
  });

  it('reuses session state attached by JwtStrategy', async () => {
    mockMetadata({});

    await expect(
      guard.canActivate(
        createContext({ sub: 'u1', sessionState: verifiedSession }),
      ),
    ).resolves.toBe(true);
    expect(authService.getUserSessionState).not.toHaveBeenCalled();
  });

  it('allows a verified user on protected routes', async () => {
    mockMetadata({});
    authService.getUserSessionState.mockResolvedValue(verifiedSession);

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('forbids an unverified user on protected routes', async () => {
    mockMetadata({});
    authService.getUserSessionState.mockResolvedValue(unverifiedSession);

    await expect(
      guard.canActivate(createContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
