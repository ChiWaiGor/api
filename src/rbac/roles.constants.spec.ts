import { ALL_PERMISSIONS, PERMISSIONS } from './permissions.constants';
import {
  isProtectedPermissionForRole,
  isReservedRoleName,
} from './roles.constants';

describe('roles.constants', () => {
  describe('isReservedRoleName', () => {
    it('returns true for system role names', () => {
      expect(isReservedRoleName('admin')).toBe(true);
      expect(isReservedRoleName('user')).toBe(true);
    });

    it('returns false for custom role names', () => {
      expect(isReservedRoleName('editor')).toBe(false);
    });
  });

  describe('isProtectedPermissionForRole', () => {
    it('protects users:read on user role', () => {
      expect(
        isProtectedPermissionForRole('user', PERMISSIONS.USERS_READ),
      ).toBe(true);
    });

    it('protects all catalog permissions on admin role', () => {
      for (const action of ALL_PERMISSIONS) {
        expect(isProtectedPermissionForRole('admin', action)).toBe(true);
      }
    });

    it('does not protect catalog permissions on custom roles', () => {
      expect(
        isProtectedPermissionForRole('editor', PERMISSIONS.USERS_DELETE),
      ).toBe(false);
    });
  });
});
