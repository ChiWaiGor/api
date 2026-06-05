import { applyDecorators, SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_MODE_KEY = 'permissionsMode';

export type PermissionsMode = 'all' | 'any';

export const RequirePermissions = (
  permissions: string[],
  mode: PermissionsMode = 'all',
) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, mode),
  );
