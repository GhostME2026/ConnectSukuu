'use strict';

const crypto = require('crypto');
const prisma = require('../config/db');

const DEFAULT_CONTENT = {
  brandPrefix: 'Connect', brandAccent: 'Sukuu', logoUrl: '',
  primaryColor: '#2563eb', secondaryColor: '#3b82f6',
  announcementEnabled: false, announcementText: '',
  homeEyebrow: 'School management software, built for Ghana',
  homeTitle: 'Run your entire school from one platform.',
  homeDescription: 'Admissions, attendance, grading, fees and parent communication — one system for owners, staff, parents and students. No spreadsheets, no lost paperwork.',
  homePrimaryCta: 'Start free trial', homeSecondaryCta: 'Book a Demo', heroImageUrl: '',
  featuresEyebrow: 'FEATURES', featuresTitle: 'One platform, ten roles, zero double entry.', featuresDescription: 'Built around what your school actually does each day.',
  aboutEyebrow: 'ABOUT CONNECTSUKUU', aboutTitle: "Schools don't run on software built for offices.", aboutDescription: 'From admission to transcript, one record.',
  pricingEyebrow: 'SIMPLE PRICING', pricingTitle: 'Priced per school, not per headache.', pricingDescription: 'Try every portal free for 30 days.',
  contactEyebrow: 'CONTACT CONNECTSUKUU', contactTitle: "Let's show you ConnectSukuu, live.", contactDescription: 'Before you reach out',
  footerBlurb: 'The affordable operating system for school owners, staff, parents and students, all in one platform. Built for Africa.',
  footerCopyright: '© 2026 ConnectSukuu. All rights reserved.',
  contactLocation: 'Accra, Ghana', contactEmail: 'connectsukuu@gmail.com', contactPhone: '+233 20 891 6616',
  features: [
    { title: 'Admissions & Records', description: 'Admission numbers, guardian details, class assignment and full academic history in one profile.' },
    { title: 'Attendance', description: 'Class-based or subject-based, marked in under a minute, with instant absence reports to parents.' },
    { title: 'Grading & Reports', description: 'Configure your own weighting including class tests, quizzes, exams and allow the system to automatically total and grade.' },
    { title: 'Fees & Payments', description: 'Invoices, MoMo and card collection, payroll and scholarships, reconciled automatically.' },
    { title: 'Communication', description: 'Keep school owners, staff, parents and students informed through announcements and messages.' },
    { title: 'Insights & Analytics', description: 'See school performance, attendance and financial trends in one place.' }
  ]
};

const TEXT_LIMITS = {
  brandPrefix: 40, brandAccent: 40, announcementText: 500, homeEyebrow: 120,
  homeTitle: 180, homeDescription: 800, homePrimaryCta: 50, homeSecondaryCta: 50,
  featuresEyebrow: 120, featuresTitle: 180, featuresDescription: 800,
  aboutEyebrow: 120, aboutTitle: 180, aboutDescription: 800,
  pricingEyebrow: 120, pricingTitle: 180, pricingDescription: 800,
  contactEyebrow: 120, contactTitle: 180, contactDescription: 800,
  footerBlurb: 500, footerCopyright: 180, contactLocation: 180,
  contactEmail: 180, contactPhone: 80
};
const URL_FIELDS = new Set(['logoUrl', 'heroImageUrl']);
const IMAGE_DATA_FIELDS = new Set(['logoUrl', 'heroImageUrl']);
const COLOR_FIELDS = new Set(['primaryColor', 'secondaryColor']);
const ALLOWED = new Set([...Object.keys(TEXT_LIMITS), ...URL_FIELDS, ...COLOR_FIELDS, 'announcementEnabled', 'features']);

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function cleanContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError('Send a content object.');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(TEXT_LIMITS, key)) {
      if (typeof value !== 'string' || value.length > TEXT_LIMITS[key]) throw httpError(`${key} must be text of at most ${TEXT_LIMITS[key]} characters.`);
      out[key] = value.trim();
    } else if (URL_FIELDS.has(key)) {
      if (typeof value !== 'string' || value.length > 500000) throw httpError(`${key} must be a URL or a compressed image under 500 KB.`);
      const trimmed = value.trim();
      if (trimmed) {
        if (IMAGE_DATA_FIELDS.has(key) && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
          // Compressed browser-generated WebP image; size limit above protects the JSON content row.
        } else {
          let parsed;
          try { parsed = new URL(trimmed); } catch (_) {}
          if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) throw httpError(`${key} must use http:// or https://, or upload a compressed WebP image.`);
        }
      }
      out[key] = trimmed;
    } else if (COLOR_FIELDS.has(key)) {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw httpError(`${key} must be a six-digit hex color.`);
      out[key] = value;
    } else if (key === 'announcementEnabled') {
      if (typeof value !== 'boolean') throw httpError('announcementEnabled must be true or false.');
      out[key] = value;
    } else if (key === 'features') {
      if (!Array.isArray(value) || value.length !== 6 || value.some(x =>
        !x || typeof x.title !== 'string' || typeof x.description !== 'string' ||
        x.title.length > 100 || x.description.length > 400)) {
        throw httpError('features must contain six title/description pairs.');
      }
      out.features = value.map(x => ({ title: x.title.trim(), description: x.description.trim() }));
    }
  }
  if (!Object.keys(out).length) throw httpError('No supported content fields were supplied.');
  return out;
}
function logStorageError(label, error) {
  // Full diagnostic stays in the backend terminal; do not expose DB details to the browser.
  console.error(`[platform-content] ${label} failed`, {
    code: error?.code || null,
    message: error?.message || String(error),
    meta: error?.meta || null
  });
}
function storageError(res, error, label) {
  logStorageError(label, error);
  const missingTable = error?.code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(error?.message || '');
  const message = missingTable
    ? 'The platform content tables are missing from the database used by this API. Confirm DATABASE_URL and run npx prisma migrate status in this backend directory.'
    : 'Platform content storage failed. Check the backend terminal for the [platform-content] diagnostic.';
  return res.status(503).json({ error: message, code: error?.code || 'CONTENT_STORAGE_ERROR' });
}

async function getPublicContent(req, res) {
  try {
    const rows = await prisma.$queryRaw`SELECT "payload", "updatedAt" FROM "PlatformContent" WHERE "id" = 'global' LIMIT 1`;
    const row = rows[0];
    return res.json({ content: row?.payload || DEFAULT_CONTENT, updatedAt: row?.updatedAt || null });
  } catch (error) {
    return storageError(res, error, 'GET public content');
  }
}

async function getAdminContent(req, res) {
  try {
    const rows = await prisma.$queryRaw`SELECT "payload", "updatedAt", "updatedById" FROM "PlatformContent" WHERE "id" = 'global' LIMIT 1`;
    const audit = await prisma.$queryRaw`
      SELECT "id", "actorUserId", "action", "createdAt"
      FROM "PlatformContentAudit"
      ORDER BY "createdAt" DESC
      LIMIT 15
    `;
    const row = rows[0];
    return res.json({
      content: row?.payload || DEFAULT_CONTENT,
      updatedAt: row?.updatedAt || null,
      updatedById: row?.updatedById || null,
      audit
    });
  } catch (error) {
    return storageError(res, error, 'GET admin content');
  }
}

async function updateAdminContent(req, res) {
  let patch;
  try { patch = cleanContent(req.body?.content); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  try {
    const rows = await prisma.$queryRaw`SELECT "payload" FROM "PlatformContent" WHERE "id" = 'global' LIMIT 1`;
    const before = rows[0]?.payload && typeof rows[0].payload === 'object' ? rows[0].payload : DEFAULT_CONTENT;
    const after = { ...before, ...patch };
    const actorId = req.user?.id || req.user?.userId;
    if (!actorId) return res.status(401).json({ error: 'Authenticated user identity is missing from the request.' });

    const saved = await prisma.$transaction(async tx => {
      const updatedRows = await tx.$queryRaw`
        INSERT INTO "PlatformContent" ("id", "payload", "updatedAt", "updatedById")
        VALUES ('global', ${JSON.stringify(after)}::jsonb, NOW(), ${String(actorId)})
        ON CONFLICT ("id") DO UPDATE
        SET "payload" = EXCLUDED."payload",
            "updatedAt" = NOW(),
            "updatedById" = EXCLUDED."updatedById"
        RETURNING "payload", "updatedAt", "updatedById"
      `;
      await tx.$executeRaw`
        INSERT INTO "PlatformContentAudit" ("id", "actorUserId", "action", "before", "after", "createdAt")
        VALUES (${crypto.randomUUID()}, ${String(actorId)}, 'UPDATE_PUBLIC_SITE_CONTENT',
                ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, NOW())
      `;
      return updatedRows[0];
    });
    return res.json({ success: true, content: saved.payload, updatedAt: saved.updatedAt, updatedById: saved.updatedById });
  } catch (error) {
    return storageError(res, error, 'PATCH admin content');
  }
}

module.exports = { getPublicContent, getAdminContent, updateAdminContent, DEFAULT_CONTENT };
