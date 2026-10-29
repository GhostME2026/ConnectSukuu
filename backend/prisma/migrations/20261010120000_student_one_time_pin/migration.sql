-- Add a separate short-lived, single-use PIN without overwriting the student's permanent PIN.
ALTER TABLE "StudentAccess"
  ADD COLUMN "temporaryPinHash" TEXT,
  ADD COLUMN "temporaryPinExpiresAt" TIMESTAMP(3);
