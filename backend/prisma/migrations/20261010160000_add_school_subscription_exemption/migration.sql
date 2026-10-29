-- Explicit access entitlement for approved demo/internal schools.
-- This is separate from SubscriptionStatus and never records a payment.
ALTER TABLE "School"
  ADD COLUMN "subscriptionExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "subscriptionExemptReason" TEXT,
  ADD COLUMN "subscriptionExemptAt" TIMESTAMP(3),
  ADD COLUMN "subscriptionExemptBy" TEXT;
