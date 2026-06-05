import {
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
} from './permissions.constants';

export const SYSTEM_ROLE_NAMES = ['admin', 'user'] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/** Permissions that must not be detached from a system role. */
export const SYSTEM_ROLE_PROTECTED_PERMISSIONS: Record<
  SystemRoleName,
  readonly string[]
> = {
  admin: [...ALL_PERMISSIONS],
  user: [...DEFAULT_USER_PERMISSIONS],
};

export function isReservedRoleName(name: string): boolean {
  return (SYSTEM_ROLE_NAMES as readonly string[]).includes(name);
}

export function isProtectedPermissionForRole(
  roleName: string,
  action: string,
): boolean {
  const protectedActions =
    SYSTEM_ROLE_PROTECTED_PERMISSIONS[roleName as SystemRoleName];
  return protectedActions?.includes(action) ?? false;
}
