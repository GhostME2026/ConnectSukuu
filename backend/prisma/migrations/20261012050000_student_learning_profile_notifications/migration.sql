-- Student workspace: branch login codes, contact profile, online homework, persistent notifications and nurse appointments.
ALTER TABLE "Branch" ADD COLUMN "code" TEXT;
WITH numbered AS (
  SELECT "id", upper(substr(md5("id"), 1, 6)) AS generated_code
  FROM "Branch"
)
UPDATE "Branch" AS b SET "code" = numbered.generated_code FROM numbered WHERE numbered."id" = b."id";
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

ALTER TABLE "Student" ADD COLUMN "email" TEXT;
ALTER TABLE "Student" ADD COLUMN "phone" TEXT;

CREATE TABLE "LearningAssignment" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "teachingAssignmentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "instructions" TEXT,
  "attachmentUrl" TEXT,
  "dueAt" TIMESTAMP(3),
  "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningAssignment_teachingAssignmentId_fkey" FOREIGN KEY ("teachingAssignmentId") REFERENCES "TeachingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LearningAssignment_schoolId_teacherId_idx" ON "LearningAssignment"("schoolId", "teacherId");
CREATE INDEX "LearningAssignment_teachingAssignmentId_dueAt_idx" ON "LearningAssignment"("teachingAssignmentId", "dueAt");

CREATE TABLE "LearningSubmission" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "learningAssignmentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "submissionText" TEXT,
  "attachmentUrl" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "score" DOUBLE PRECISION,
  "feedback" TEXT,
  "gradedAt" TIMESTAMP(3),
  "gradedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningSubmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningSubmission_learningAssignmentId_fkey" FOREIGN KEY ("learningAssignmentId") REFERENCES "LearningAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LearningSubmission_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearningSubmission_learningAssignmentId_studentId_key" ON "LearningSubmission"("learningAssignmentId", "studentId");
CREATE INDEX "LearningSubmission_schoolId_studentId_idx" ON "LearningSubmission"("schoolId", "studentId");
CREATE INDEX "LearningSubmission_learningAssignmentId_submittedAt_idx" ON "LearningSubmission"("learningAssignmentId", "submittedAt");

CREATE TABLE "StudentNotification" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GENERAL',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "targetUrl" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentNotification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudentNotification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StudentNotification_schoolId_studentId_createdAt_idx" ON "StudentNotification"("schoolId", "studentId", "createdAt");
CREATE INDEX "StudentNotification_studentId_readAt_idx" ON "StudentNotification"("studentId", "readAt");

CREATE TABLE "NurseAppointment" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "nurseId" TEXT,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NurseAppointment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurseAppointment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NurseAppointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NurseAppointment_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "NurseAppointment_schoolId_studentId_scheduledAt_idx" ON "NurseAppointment"("schoolId", "studentId", "scheduledAt");
CREATE INDEX "NurseAppointment_nurseId_scheduledAt_idx" ON "NurseAppointment"("nurseId", "scheduledAt");
