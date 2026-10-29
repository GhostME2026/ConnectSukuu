-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "includeOtherDeduction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otherDeductionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
