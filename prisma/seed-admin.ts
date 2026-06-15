import { PrismaClient } from '@prisma/client';
import {
  getArgon2OptionsFromEnv,
  hashPassword,
} from '../src/common/crypto/argon2.util';
import { isTruthyEnv, runSeedScript } from './seed-runner';

/**
 * Creates the bootstrap admin user on first run. Does not overwrite an
 * existing admin password unless SEED_ADMIN_ROTATE_PASSWORD=true.
 */
export async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!@#';
  const rotatePassword = isTruthyEnv(process.env.SEED_ADMIN_ROTATE_PASSWORD);

  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
  if (!adminRole) {
    throw new Error('Admin role not found. Run seed-catalog first.');
  }

  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  const argon2Options = getArgon2OptionsFromEnv({
    ARGON2_MEMORY_KB: Number(process.env.ARGON2_MEMORY_KB ?? 65536),
    ARGON2_TIME_COST: Number(process.env.ARGON2_TIME_COST ?? 3),
    ARGON2_PARALLELISM: Number(process.env.ARGON2_PARALLELISM ?? 4),
  });

  const passwordHash = await hashPassword(adminPassword, argon2Options);

  if (existing) {
    if (rotatePassword) {
      await prisma.user.update({
        where: { email: adminEmail },
        data: { passwordHash, emailVerifiedAt: new Date() },
      });
      console.log(`Rotated admin password: ${adminEmail}`);
      return;
    }

    console.log(
      `Admin user already exists (${adminEmail}); skipping password update (set SEED_ADMIN_ROTATE_PASSWORD=true to rotate)`,
    );
    return;
  }

  await prisma.user.create({
    data: {
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

if (require.main === module) {
  void runSeedScript(seedAdmin);
}
