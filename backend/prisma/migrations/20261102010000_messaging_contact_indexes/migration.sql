-- Speeds up role- and branch-scoped contact lookup for direct messaging.
CREATE INDEX IF NOT EXISTS "User_schoolId_isActive_branchId_role_idx"
ON "User" ("schoolId", "isActive", "branchId", "role");

CREATE INDEX IF NOT EXISTS "User_schoolId_isActive_role_idx"
ON "User" ("schoolId", "isActive", "role");
