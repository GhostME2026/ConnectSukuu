/*
  Warnings:

  - Made the column `classId` on table `TimetableEntry` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "TimetableEntry" DROP CONSTRAINT "TimetableEntry_classId_fkey";

-- AlterTable
ALTER TABLE "TimetableEntry" ALTER COLUMN "classId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
