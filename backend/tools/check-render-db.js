#!/usr/bin/env node
'use strict';
require('dotenv').config();
const prisma = require('../src/config/db');
(async()=>{
  const started=Date.now();
  try {
    await prisma.$queryRaw`SELECT 1 AS connectivity_check`;
    console.log(`DATABASE CHECK PASSED (${Date.now()-started} ms): Prisma reached PostgreSQL and executed SELECT 1.`);
  } catch (err) {
    const code=err && (err.code || err.errorCode) || 'UNKNOWN';
    console.error(`DATABASE CHECK FAILED (${Date.now()-started} ms). Code: ${code}`);
    if(code==='P2024') console.error('Diagnosis: Prisma waited for a pooled connection and timed out. Check long-running queries/transactions, concurrent jobs, and connection_limit in DATABASE_URL; increasing timeout alone is not a fix.');
    else if(code==='P1001' || /Can't reach database server|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(String(err.message||''))) console.error('Diagnosis: the database host was unreachable at test time. Check Render database availability, host/port, outbound connectivity, DNS, and whether the service is suspended. This is separate from pool saturation.');
    else console.error('Diagnosis: inspect the error below; this diagnostic makes no database changes.');
    console.error(String(err && err.message || err).replace(/(postgres(?:ql)?:\/\/[^:\s/]+):[^@\s]+@/ig,'$1:[REDACTED]@'));
    process.exitCode=1;
  } finally { try { await prisma.$disconnect(); } catch (_) {} }
})();
