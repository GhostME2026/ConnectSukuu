#!/usr/bin/env python3
from pathlib import Path
import shutil, re

schema = Path("prisma/schema.prisma")
if not schema.exists():
    raise SystemExit("ERROR: prisma/schema.prisma not found. Run this from connectsukuu-backend.")

text = schema.read_text(encoding="utf-8")
backup = schema.with_name("schema.prisma.before-finance-foundation")
if not backup.exists():
    shutil.copy2(schema, backup)

def span(src, name):
    m = re.search(r"(?m)^model\s+" + re.escape(name) + r"\s*\{", src)
    if not m:
        raise SystemExit("ERROR: model " + name + " not found.")
    depth = 0
    i = m.end()
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            if depth == 0:
                return m.start(), i + 1
            depth -= 1
        i += 1
    raise SystemExit("ERROR: could not parse model " + name)

def add(model, lines):
    global text
    start, end = span(text, model)
    block = text[start:end]
    existing = {x.strip().split()[0] for x in block.splitlines()
                if x.strip() and not x.strip().startswith("@")}
    missing = [line for line in lines if line.strip().split()[0] not in existing]
    if not missing:
        return False
    pos = end - 1
    text = text[:pos] + "\n" + "\n".join(missing) + "\n" + text[pos:]
    return True

changed = False

changed |= add("School", [
    "  feePlans FeePlan[]",
    "  feeImportBatches FeeImportBatch[]",
])
changed |= add("AcademicYear", [
    "  feePlans FeePlan[]",
    "  feeImportBatches FeeImportBatch[]",
    "  studentFees StudentFee[]",
])
changed |= add("Term", [
    "  feePlans FeePlan[]",
    "  feeImportBatches FeeImportBatch[]",
    "  studentFees StudentFee[]",
])
changed |= add("SchoolClass", [
    "  feePlans FeePlan[]",
    "  feeImportBatches FeeImportBatch[]",
    "  studentFees StudentFee[]",
])
changed |= add("Student", [
    "  feeImportRows FeeImportRow[]",
])

changed |= add("StudentFee", [
    "  academicYearId String?",
    "  termId String?",
    "  classId String?",
    "  feePlanId String?",
    "  feePlanItemId String?",
    "  importBatchId String?",
    "  academicYear AcademicYear? @relation(fields: [academicYearId], references: [id])",
    "  term Term? @relation(fields: [termId], references: [id])",
    "  schoolClass SchoolClass? @relation(fields: [classId], references: [id])",
    "  feePlan FeePlan? @relation(fields: [feePlanId], references: [id])",
    "  feePlanItem FeePlanItem? @relation(fields: [feePlanItemId], references: [id])",
    "  importBatch FeeImportBatch? @relation(fields: [importBatchId], references: [id])",
])

changed |= add("PayrollRecord", [
    "  grossSalary Int?",
    "  taxAmount Int @default(0)",
    "  statutoryDeductions Int @default(0)",
    "  otherDeductions Int @default(0)",
])

if not re.search(r"(?m)^model\s+FeePlan\s*\{", text):
    text += r'''

model FeePlan {
  id             String       @id @default(cuid())
  schoolId       String
  academicYearId String
  termId         String
  classId        String
  name           String
  description    String?
  currency       String       @default("GHS")
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  school         School       @relation(fields: [schoolId], references: [id])
  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id])
  term           Term         @relation(fields: [termId], references: [id])
  schoolClass    SchoolClass  @relation(fields: [classId], references: [id])
  items          FeePlanItem[]
  studentFees    StudentFee[]

  @@unique([schoolId, academicYearId, termId, classId])
  @@index([schoolId])
  @@index([academicYearId])
  @@index([termId])
  @@index([classId])
  @@index([isActive])
}

model FeePlanItem {
  id           String      @id @default(cuid())
  schoolId     String
  feePlanId    String
  name         String
  code         String?
  amount       Int?
  isRequired   Boolean     @default(false)
  sortOrder    Int         @default(0)
  description  String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  feePlan      FeePlan     @relation(fields: [feePlanId], references: [id], onDelete: Cascade)
  studentFees  StudentFee[]

  @@index([schoolId])
  @@index([feePlanId])
  @@index([sortOrder])
}

model FeeImportBatch {
  id              String       @id @default(cuid())
  schoolId        String
  academicYearId  String
  termId          String
  classId         String
  fileName        String?
  format          String
  status          String       @default("PENDING")
  importedById    String
  totalRows       Int          @default(0)
  successRows     Int          @default(0)
  failedRows      Int          @default(0)
  createdAt       DateTime     @default(now())
  completedAt     DateTime?

  school          School       @relation(fields: [schoolId], references: [id])
  academicYear    AcademicYear @relation(fields: [academicYearId], references: [id])
  term            Term         @relation(fields: [termId], references: [id])
  schoolClass     SchoolClass  @relation(fields: [classId], references: [id])
  studentFees     StudentFee[]
  rows            FeeImportRow[]

  @@index([schoolId])
  @@index([academicYearId])
  @@index([termId])
  @@index([classId])
  @@index([importedById])
  @@index([createdAt])
}

model FeeImportRow {
  id               String          @id @default(cuid())
  importBatchId    String
  rowNumber        Int
  admissionNumber  String?
  studentId        String?
  status           String          @default("PENDING")
  errorMessage     String?
  createdAt        DateTime        @default(now())

  importBatch      FeeImportBatch  @relation(fields: [importBatchId], references: [id], onDelete: Cascade)
  student          Student?        @relation(fields: [studentId], references: [id])

  @@index([importBatchId])
  @@index([studentId])
}
'''
    changed = True

if changed:
    schema.write_text(text, encoding="utf-8")
    print("Finance foundation schema changes installed.")
else:
    print("Finance foundation changes already present; no changes made.")
print("Backup:", backup)
