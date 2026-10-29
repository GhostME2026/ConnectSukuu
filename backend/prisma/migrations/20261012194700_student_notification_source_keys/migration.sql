-- Stable source keys ensure one student notification per originating event and student.
ALTER TABLE "StudentNotification" ADD COLUMN "sourceKey" TEXT;
CREATE UNIQUE INDEX "StudentNotification_schoolId_studentId_sourceKey_key" ON "StudentNotification"("schoolId", "studentId", "sourceKey");
