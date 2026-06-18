export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',
  PERMISSIONS_READ: 'permissions:read',
  PERMISSIONS_MANAGE: 'permissions:manage',
} as const;

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ALL_PERMISSIONS_SET = new Set<string>(ALL_PERMISSIONS);

export const DEFAULT_USER_PERMISSIONS = [PERMISSIONS.USERS_READ] as const;
