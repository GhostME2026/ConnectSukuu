-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "headTeacherApprovedAt" TIMESTAMP(3),
ADD COLUMN     "headTeacherApprovedById" TEXT,
ADD COLUMN     "ownerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "ownerApprovedById" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_headTeacherApprovedById_fkey" FOREIGN KEY ("headTeacherApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_ownerApprovedById_fkey" FOREIGN KEY ("ownerApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
