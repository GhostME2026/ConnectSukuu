ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "attachmentName" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "attachmentPath" TEXT;
