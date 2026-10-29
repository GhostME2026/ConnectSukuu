-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "grossSalary" INTEGER,
ADD COLUMN     "otherDeductions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "statutoryDeductions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StudentFee" ADD COLUMN     "academicYearId" TEXT,
ADD COLUMN     "classId" TEXT,
ADD COLUMN     "feePlanId" TEXT,
ADD COLUMN     "feePlanItemId" TEXT,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "termId" TEXT;

-- CreateTable
CREATE TABLE "FeePlan" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePlanItem" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "feePlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "amount" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeImportBatch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "fileName" TEXT,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "importedById" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FeeImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeImportRow" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "admissionNumber" TEXT,
    "studentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeePlan_schoolId_idx" ON "FeePlan"("schoolId");

-- CreateIndex
CREATE INDEX "FeePlan_academicYearId_idx" ON "FeePlan"("academicYearId");

-- CreateIndex
CREATE INDEX "FeePlan_termId_idx" ON "FeePlan"("termId");

-- CreateIndex
CREATE INDEX "FeePlan_classId_idx" ON "FeePlan"("classId");

-- CreateIndex
CREATE INDEX "FeePlan_isActive_idx" ON "FeePlan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FeePlan_schoolId_academicYearId_termId_classId_key" ON "FeePlan"("schoolId", "academicYearId", "termId", "classId");

-- CreateIndex
CREATE INDEX "FeePlanItem_schoolId_idx" ON "FeePlanItem"("schoolId");

-- CreateIndex
CREATE INDEX "FeePlanItem_feePlanId_idx" ON "FeePlanItem"("feePlanId");

-- CreateIndex
CREATE INDEX "FeePlanItem_sortOrder_idx" ON "FeePlanItem"("sortOrder");

-- CreateIndex
CREATE INDEX "FeeImportBatch_schoolId_idx" ON "FeeImportBatch"("schoolId");

-- CreateIndex
CREATE INDEX "FeeImportBatch_academicYearId_idx" ON "FeeImportBatch"("academicYearId");

-- CreateIndex
CREATE INDEX "FeeImportBatch_termId_idx" ON "FeeImportBatch"("termId");

-- CreateIndex
CREATE INDEX "FeeImportBatch_classId_idx" ON "FeeImportBatch"("classId");

-- CreateIndex
CREATE INDEX "FeeImportBatch_importedById_idx" ON "FeeImportBatch"("importedById");

-- CreateIndex
CREATE INDEX "FeeImportBatch_createdAt_idx" ON "FeeImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "FeeImportRow_importBatchId_idx" ON "FeeImportRow"("importBatchId");

-- CreateIndex
CREATE INDEX "FeeImportRow_studentId_idx" ON "FeeImportRow"("studentId");

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_feePlanItemId_fkey" FOREIGN KEY ("feePlanItemId") REFERENCES "FeePlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFee" ADD CONSTRAINT "StudentFee_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "FeeImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlan" ADD CONSTRAINT "FeePlan_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePlanItem" ADD CONSTRAINT "FeePlanItem_feePlanId_fkey" FOREIGN KEY ("feePlanId") REFERENCES "FeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportBatch" ADD CONSTRAINT "FeeImportBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportBatch" ADD CONSTRAINT "FeeImportBatch_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportBatch" ADD CONSTRAINT "FeeImportBatch_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportBatch" ADD CONSTRAINT "FeeImportBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportRow" ADD CONSTRAINT "FeeImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "FeeImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeImportRow" ADD CONSTRAINT "FeeImportRow_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
