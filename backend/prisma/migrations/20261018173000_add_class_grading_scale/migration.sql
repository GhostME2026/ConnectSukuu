-- Additive support for per-class grading scale assignments.
CREATE TABLE IF NOT EXISTS "ClassGradingScale" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "gradingScaleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassGradingScale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassGradingScale_academicYearId_classId_key"
    ON "ClassGradingScale"("academicYearId", "classId");
CREATE INDEX IF NOT EXISTS "ClassGradingScale_schoolId_idx"
    ON "ClassGradingScale"("schoolId");
CREATE INDEX IF NOT EXISTS "ClassGradingScale_schoolId_academicYearId_classId_idx"
    ON "ClassGradingScale"("schoolId", "academicYearId", "classId");
CREATE INDEX IF NOT EXISTS "ClassGradingScale_gradingScaleId_idx"
    ON "ClassGradingScale"("gradingScaleId");
