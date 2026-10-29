CREATE TABLE "SubscriptionCancellationRequest" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "SubscriptionCancellationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionCancellationRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SubscriptionCancellationRequest_status_requestedAt_idx" ON "SubscriptionCancellationRequest"("status", "requestedAt");
CREATE INDEX "SubscriptionCancellationRequest_schoolId_requestedAt_idx" ON "SubscriptionCancellationRequest"("schoolId", "requestedAt");
