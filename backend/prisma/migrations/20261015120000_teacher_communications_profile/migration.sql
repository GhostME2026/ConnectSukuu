-- ConnectSukuu Teacher communications and staff profile-photo support.
-- Idempotent by design: existing columns/tables/indexes are preserved.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "audienceAll" BOOLEAN NOT NULL DEFAULT false,
  "audienceRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Announcement_schoolId_createdAt_idx" ON "Announcement"("schoolId", "createdAt");
CREATE INDEX IF NOT EXISTS "Announcement_branchId_idx" ON "Announcement"("branchId");

CREATE TABLE IF NOT EXISTS "UserNotification" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GENERAL',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "targetUrl" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UserNotification_schoolId_userId_createdAt_idx" ON "UserNotification"("schoolId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx" ON "UserNotification"("userId", "readAt");
