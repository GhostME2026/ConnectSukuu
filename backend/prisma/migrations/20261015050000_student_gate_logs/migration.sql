CREATE TABLE "StudentGateLog" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "recordedById" TEXT,
  "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentGateLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentGateLog_schoolId_occurredAt_idx" ON "StudentGateLog"("schoolId", "occurredAt");
CREATE INDEX "StudentGateLog_studentId_occurredAt_idx" ON "StudentGateLog"("studentId", "occurredAt");
CREATE INDEX "StudentGateLog_recordedById_idx" ON "StudentGateLog"("recordedById");
ALTER TABLE "StudentGateLog" ADD CONSTRAINT "StudentGateLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGateLog" ADD CONSTRAINT "StudentGateLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGateLog" ADD CONSTRAINT "StudentGateLog_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
