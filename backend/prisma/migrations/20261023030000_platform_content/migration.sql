CREATE TABLE "PlatformContent" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "payload" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  CONSTRAINT "PlatformContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformContentAudit" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformContentAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformContentAudit_createdAt_idx" ON "PlatformContentAudit"("createdAt");
CREATE INDEX "PlatformContentAudit_actorUserId_idx" ON "PlatformContentAudit"("actorUserId");
