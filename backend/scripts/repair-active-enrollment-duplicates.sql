-- Run only after taking a database backup and reviewing check-active-enrollment-duplicates.sql.
-- Keeps the most recently enrolled ACTIVE placement per student and academic year;
-- changes older duplicate ACTIVE placements to INACTIVE without deleting history.
BEGIN;
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "schoolId", "studentId", "academicYearId"
    ORDER BY "enrolledAt" DESC, "id" DESC
  ) AS rn
  FROM "Enrollment"
  WHERE "status" = 'ACTIVE'
)
UPDATE "Enrollment" AS e
SET "status" = 'INACTIVE'
FROM ranked AS r
WHERE e."id" = r."id" AND r.rn > 1;
COMMIT;
