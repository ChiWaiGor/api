import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
} from '../src/rbac/permissions.constants';
import { runSeedScript } from './seed-runner';

/**
 * Upserts permissions, system roles, and role-permission links.
 * Safe to run on every deploy when the permission catalog changes.
 */
export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  const permissions = await Promise.all(
    ALL_PERMISSIONS.map((action) =>
      prisma.permission.upsert({
        where: { action },
        update: {},
        create: {
          action,
          description: `Permission: ${action}`,
        },
      }),
    ),
  );

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: { isSystem: true },
    create: {
      name: 'admin',
      description: 'Full system access',
      isSystem: true,
    },
  });

  const userRole = await prisma.role.upsert({
    where: { name: 'user' },
    update: { isSystem: true },
    create: {
      name: 'user',
      description: 'Standard user',
      isSystem: true,
    },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }

  const permissionsByAction = new Map(
    permissions.map((permission) => [permission.action, permission]),
  );

  for (const action of DEFAULT_USER_PERMISSIONS) {
    const permission = permissionsByAction.get(action);
    if (!permission) {
      throw new Error(
        `Default user permission "${action}" is not in ALL_PERMISSIONS`,
      );
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: userRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: userRole.id,
        permissionId: permission.id,
      },
    });
  }

  console.log(
    `Seeded catalog: ${permissions.length} permissions, roles admin/user`,
  );
}

if (require.main === module) {
  void runSeedScript(seedCatalog);
}
