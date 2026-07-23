-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedLoginWindowStartedAt" TIMESTAMP(3);
