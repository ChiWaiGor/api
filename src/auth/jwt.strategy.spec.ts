import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const authService = { isAccessTokenBlacklisted: jest.fn() };

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
  });

  it('rejects blacklisted access tokens', async () => {
    authService.isAccessTokenBlacklisted.mockResolvedValue(true);
    const payload = {
      sub: 'user-1',
      email: 'a@b.com',
      roles: ['user'],
      jti: 'jti-1',
    };

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns payload when token is not blacklisted', async () => {
    authService.isAccessTokenBlacklisted.mockResolvedValue(false);
    const payload = {
      sub: 'user-1',
      email: 'a@b.com',
      roles: ['user'],
      jti: 'jti-1',
    };

    await expect(strategy.validate(payload)).resolves.toBe(payload);
  });
});
