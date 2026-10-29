const { PrismaClient } = require('@prisma/client');

// One shared Prisma client for the entire API process. The earlier runtime
// logs repeatedly showed P2024 with connection_limit=5 while endpoints ran
// several concurrent queries. Raise the default pool to 10 and pool wait to
// 20 seconds; both remain explicitly configurable for the Render DB plan.
function buildDatabaseUrl(raw) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const limit = Number.parseInt(process.env.PRISMA_CONNECTION_LIMIT || '10', 10);
    const poolTimeout = Number.parseInt(process.env.PRISMA_POOL_TIMEOUT || '20', 10);
    if (Number.isFinite(limit) && limit >= 1) url.searchParams.set('connection_limit', String(limit));
    if (Number.isFinite(poolTimeout) && poolTimeout >= 1) url.searchParams.set('pool_timeout', String(poolTimeout));
    return url.toString();
  } catch (_) {
    // Preserve the configured URL as-is if it is not a valid URL string.
    return raw;
  }
}

const databaseUrl = buildDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {});

module.exports = prisma;
