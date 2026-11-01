#!/usr/bin/env node
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const required = ['trustedDevice', 'supportTicketMessage', 'platformNotification'];
const missing = required.filter((name) => !prisma[name] || typeof prisma[name].findMany !== 'function');
(async () => {
  try {
    if (missing.length) {
      console.error('Prisma Client is missing model delegates:', missing.join(', '));
      console.error('Run `npx prisma generate --schema prisma/schema.prisma` from the backend directory that starts this API, then restart the backend.');
      process.exitCode = 1;
      return;
    }
    console.log('Prisma Client support models are available:', required.join(', '));
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connection OK.');
  } catch (error) {
    console.error('Prisma verification failed:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
