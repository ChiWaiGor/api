import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthCookieService } from '../auth-cookie.service';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let authCookies: jest.Mocked<
    Pick<AuthCookieService, 'hasBearerAuth' | 'hasAuthCookies' | 'isCsrfValid'>
  >;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  const createContext = (req: Partial<Request>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  beforeEach(() => {
    authCookies = {
      hasBearerAuth: jest.fn(),
      hasAuthCookies: jest.fn(),
      isCsrfValid: jest.fn(),
    };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new CsrfGuard(
      reflector as unknown as Reflector,
      authCookies as unknown as AuthCookieService,
    );
  });

  it('allows safe methods without CSRF', () => {
    expect(guard.canActivate(createContext({ method: 'GET' } as Request))).toBe(
      true,
    );
  });

  it('allows bearer-authenticated mutations', () => {
    authCookies.hasBearerAuth.mockReturnValue(true);
    expect(
      guard.canActivate(createContext({ method: 'POST' } as Request)),
    ).toBe(true);
  });

  it('allows cookie-less mutations', () => {
    authCookies.hasBearerAuth.mockReturnValue(false);
    authCookies.hasAuthCookies.mockReturnValue(false);
    expect(
      guard.canActivate(createContext({ method: 'POST' } as Request)),
    ).toBe(true);
  });

  it('requires valid CSRF for cookie-authenticated mutations', () => {
    authCookies.hasBearerAuth.mockReturnValue(false);
    authCookies.hasAuthCookies.mockReturnValue(true);
    authCookies.isCsrfValid.mockReturnValue(true);

    expect(
      guard.canActivate(createContext({ method: 'POST' } as Request)),
    ).toBe(true);
  });

  it('rejects invalid CSRF for cookie-authenticated mutations', () => {
    authCookies.hasBearerAuth.mockReturnValue(false);
    authCookies.hasAuthCookies.mockReturnValue(true);
    authCookies.isCsrfValid.mockReturnValue(false);

    expect(() =>
      guard.canActivate(createContext({ method: 'POST' } as Request)),
    ).toThrow(ForbiddenException);
  });

  it('skips CSRF when handler is exempt', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    authCookies.hasAuthCookies.mockReturnValue(true);
    authCookies.isCsrfValid.mockReturnValue(false);

    expect(
      guard.canActivate(createContext({ method: 'POST' } as Request)),
    ).toBe(true);
  });
});
