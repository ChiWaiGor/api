import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const reflector = { getAllAndOverride: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = module.get(JwtAuthGuard);
    reflector.getAllAndOverride.mockReset();
  });

  const createContext = () =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  it('bypasses auth for public routes', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('delegates to passport for protected routes', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const parentActivate = jest
      .spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype),
        'canActivate',
      )
      .mockReturnValue(true);

    expect(guard.canActivate(createContext())).toBe(true);
    expect(parentActivate).toHaveBeenCalled();
    parentActivate.mockRestore();
  });
});
