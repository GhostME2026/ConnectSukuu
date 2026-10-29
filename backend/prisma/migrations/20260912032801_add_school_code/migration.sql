/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `School` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "School" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");
