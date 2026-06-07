import { PrismaClient } from '@prisma/client';
import {
  getArgon2OptionsFromEnv,
  hashPassword,
} from '../src/common/crypto/argon2.util';
import { ALL_PERMISSIONS, PERMISSIONS } from '../src/rbac/permissions.constants';

const prisma = new PrismaClient();

async function main() {
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

  const userRead = permissions.find((p) => p.action === PERMISSIONS.USERS_READ);
  if (userRead) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: userRole.id,
          permissionId: userRead.id,
        },
      },
      update: {},
      create: {
        roleId: userRole.id,
        permissionId: userRead.id,
      },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!@#';

  const argon2Options = getArgon2OptionsFromEnv({
    ARGON2_MEMORY_KB: Number(process.env.ARGON2_MEMORY_KB ?? 65536),
    ARGON2_TIME_COST: Number(process.env.ARGON2_TIME_COST ?? 3),
    ARGON2_PARALLELISM: Number(process.env.ARGON2_PARALLELISM ?? 4),
  });

  const passwordHash = await hashPassword(adminPassword, argon2Options);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, emailVerifiedAt: new Date() },
    create: {
      email: adminEmail,
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: {
        create: [{ roleId: adminRole.id }],
      },
    },
  });

  console.log(`Seeded admin user: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
