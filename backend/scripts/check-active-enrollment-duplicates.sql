-- Read-only check: active class placements that could show a student in multiple classes in one academic year.
SELECT "schoolId", "studentId", "academicYearId", COUNT(*) AS active_placements,
       ARRAY_AGG("id" ORDER BY "enrolledAt" DESC) AS enrollment_ids
FROM "Enrollment"
WHERE "status" = 'ACTIVE'
GROUP BY "schoolId", "studentId", "academicYearId"
HAVING COUNT(*) > 1
ORDER BY active_placements DESC;
