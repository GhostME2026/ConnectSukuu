-- ConnectSukuu Owner workspace foundation. Additive migration; preserves existing rows.
ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "schoolType" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS "estimatedStudentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'Ghana',
  ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Branch" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);

-- Give existing schools without any branch a Main Campus, then attach existing
-- branch-dependent users/students only when the school has exactly one branch.
-- This keeps historical records in place and avoids guessing when multiple
-- campuses already exist.
INSERT INTO "Branch" ("id","schoolId","name","schoolType","estimatedStudentCount","country","region","city","address","status","createdAt","updatedAt")
SELECT 'legacy-' || substr(md5(s."id" || clock_timestamp()::text),1,24), s."id", 'Main Campus', 'OTHER', 0, 'Ghana', '', '', '', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "School" s
WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."schoolId" = s."id");

UPDATE "User" u SET "branchId" = only_branch.id
FROM (
  SELECT "schoolId", MIN("id") AS id
  FROM "Branch"
  GROUP BY "schoolId"
  HAVING COUNT(*) = 1
) only_branch
WHERE u."schoolId" = only_branch."schoolId"
  AND u."role" NOT IN ('OWNER','SUPER_ADMIN')
  AND u."branchId" IS NULL;

UPDATE "Student" st SET "branchId" = only_branch.id
FROM (
  SELECT "schoolId", MIN("id") AS id
  FROM "Branch"
  GROUP BY "schoolId"
  HAVING COUNT(*) = 1
) only_branch
WHERE st."schoolId" = only_branch."schoolId"
  AND st."branchId" IS NULL;

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "audienceAll" BOOLEAN NOT NULL DEFAULT FALSE,
  "audienceRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "DirectMessage" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "branchId" TEXT,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);
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
CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "branchId" TEXT,
  "createdById" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "attachmentName" TEXT,
  "attachmentPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Branch_schoolId_status_idx" ON "Branch"("schoolId","status");
CREATE INDEX IF NOT EXISTS "Announcement_schoolId_createdAt_idx" ON "Announcement"("schoolId","createdAt");
CREATE INDEX IF NOT EXISTS "Announcement_branchId_createdAt_idx" ON "Announcement"("branchId","createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_schoolId_senderId_createdAt_idx" ON "DirectMessage"("schoolId","senderId","createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_schoolId_recipientId_createdAt_idx" ON "DirectMessage"("schoolId","recipientId","createdAt");
CREATE INDEX IF NOT EXISTS "UserNotification_schoolId_userId_createdAt_idx" ON "UserNotification"("schoolId","userId","createdAt");
CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_idx" ON "UserNotification"("userId","readAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_schoolId_createdAt_idx" ON "SupportTicket"("schoolId","createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdById_createdAt_idx" ON "SupportTicket"("createdById","createdAt");
