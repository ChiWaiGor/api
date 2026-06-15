import { PrismaClient } from '@prisma/client';

export function isTruthyEnv(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export async function runSeedScript(
  fn: (prisma: PrismaClient) => Promise<void>,
): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await fn(prisma);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
