import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const authService = {
    isAccessTokenBlacklisted: jest.fn(),
    getUserSessionState: jest.fn(),
    assertActiveSession: jest.fn(),
  };

  const payload = {
    sub: 'user-1',
    email: 'a@b.com',
    roles: ['user'],
    jti: 'jti-1',
  };

  const activeSession = {
    status: UserStatus.ACTIVE,
    emailVerifiedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: () => 'a'.repeat(32),
          },
        },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
    jest.clearAllMocks();
    authService.isAccessTokenBlacklisted.mockResolvedValue(false);
    authService.getUserSessionState.mockResolvedValue(activeSession);
    authService.assertActiveSession.mockImplementation(() => undefined);
  });

  it('rejects blacklisted access tokens', async () => {
    authService.isAccessTokenBlacklisted.mockResolvedValue(true);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authService.getUserSessionState).not.toHaveBeenCalled();
  });

  it('loads session state and rejects inactive sessions', async () => {
    authService.assertActiveSession.mockImplementation(() => {
      throw new UnauthorizedException('Account is inactive');
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authService.getUserSessionState).toHaveBeenCalledWith('user-1');
  });

  it('returns payload with session state when token and session are valid', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual({
      ...payload,
      sessionState: activeSession,
    });
  });
});
