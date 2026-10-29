-- Add the nullable profile-photo column expected by the current Prisma User model.
-- This is additive and preserves existing accounts and records.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
