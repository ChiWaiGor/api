import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSIONS } from '../../rbac/permissions.constants';
import { RbacService } from '../../rbac/rbac.service';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let rbac: { getUserPermissions: jest.Mock };

  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(async () => {
    rbac = { getUserPermissions: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflector },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector.getAllAndOverride.mockReset();
  });

  const createContext = (user?: { sub: string }) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  it('allows when no permissions are required', async () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined).mockReturnValueOnce('all');
    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(true);
  });

  it('denies when user lacks required permissions', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce([PERMISSIONS.USERS_WRITE])
      .mockReturnValueOnce('all');
    rbac.getUserPermissions.mockResolvedValue([PERMISSIONS.USERS_READ]);

    await expect(
      guard.canActivate(createContext({ sub: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows when user has all required permissions', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce([PERMISSIONS.USERS_READ, PERMISSIONS.USERS_WRITE])
      .mockReturnValueOnce('all');
    rbac.getUserPermissions.mockResolvedValue([
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_WRITE,
    ]);

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(true);
  });

  it('denies when user is missing', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce([PERMISSIONS.USERS_READ])
      .mockReturnValueOnce('all');

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows when mode is any and user has one permission', async () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce([PERMISSIONS.USERS_READ, PERMISSIONS.USERS_WRITE])
      .mockReturnValueOnce('any');
    rbac.getUserPermissions.mockResolvedValue([PERMISSIONS.USERS_READ]);

    await expect(guard.canActivate(createContext({ sub: 'u1' }))).resolves.toBe(
      true,
    );
  });
});
