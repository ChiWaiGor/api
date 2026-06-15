import { PrismaClient } from '@prisma/client';
import { seedAdmin } from './seed-admin';
import { seedCatalog } from './seed-catalog';

/**
 * Full seed for local dev, CI, and e2e. Production should run catalog and
 * admin separately (see README production deployment).
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    await seedCatalog(prisma);
    await seedAdmin(prisma);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
