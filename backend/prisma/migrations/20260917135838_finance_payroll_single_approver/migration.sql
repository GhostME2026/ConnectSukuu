/*
  Warnings:

  - You are about to drop the column `headTeacherApprovedAt` on the `PayrollRecord` table. All the data in the column will be lost.
  - You are about to drop the column `headTeacherApprovedById` on the `PayrollRecord` table. All the data in the column will be lost.
  - You are about to drop the column `ownerApprovedAt` on the `PayrollRecord` table. All the data in the column will be lost.
  - You are about to drop the column `ownerApprovedById` on the `PayrollRecord` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "PayrollRecord" DROP CONSTRAINT "PayrollRecord_headTeacherApprovedById_fkey";

-- DropForeignKey
ALTER TABLE "PayrollRecord" DROP CONSTRAINT "PayrollRecord_ownerApprovedById_fkey";

-- AlterTable
ALTER TABLE "PayrollRecord" DROP COLUMN "headTeacherApprovedAt",
DROP COLUMN "headTeacherApprovedById",
DROP COLUMN "ownerApprovedAt",
DROP COLUMN "ownerApprovedById";
