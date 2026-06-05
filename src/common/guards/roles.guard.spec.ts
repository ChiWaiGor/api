import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const reflector = { getAllAndOverride: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = module.get(RolesGuard);
    reflector.getAllAndOverride.mockReset();
  });

  const createContext = (user?: { roles: string[] }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  it('allows when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('denies when user is missing', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(guard.canActivate(createContext())).toBe(false);
  });

  it('allows when user has a required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin', 'user']);
    expect(
      guard.canActivate(createContext({ roles: ['user'] })),
    ).toBe(true);
  });

  it('denies when user lacks required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(
      guard.canActivate(createContext({ roles: ['user'] })),
    ).toBe(false);
  });
});
