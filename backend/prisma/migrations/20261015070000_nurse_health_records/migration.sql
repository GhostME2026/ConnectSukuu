CREATE TABLE "NurseHealthRecord" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "nurseId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL DEFAULT 'CONSULTATION',
  "symptoms" TEXT,
  "assessment" TEXT NOT NULL,
  "treatment" TEXT,
  "medication" TEXT,
  "temperatureC" DOUBLE PRECISION,
  "bloodPressure" TEXT,
  "followUpAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NurseHealthRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NurseHealthRecord_schoolId_createdAt_idx" ON "NurseHealthRecord"("schoolId", "createdAt");
CREATE INDEX "NurseHealthRecord_studentId_createdAt_idx" ON "NurseHealthRecord"("studentId", "createdAt");
CREATE INDEX "NurseHealthRecord_nurseId_createdAt_idx" ON "NurseHealthRecord"("nurseId", "createdAt");
ALTER TABLE "NurseHealthRecord" ADD CONSTRAINT "NurseHealthRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NurseHealthRecord" ADD CONSTRAINT "NurseHealthRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NurseHealthRecord" ADD CONSTRAINT "NurseHealthRecord_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
