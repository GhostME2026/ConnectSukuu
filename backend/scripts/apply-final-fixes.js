#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.cwd());
const candidates = [
  path.join(root, 'connectsukuu-backend', 'src', 'controllers', 'student.controller.js'),
  path.join(root, 'backend', 'src', 'controllers', 'student.controller.js'),
  path.join(root, 'src', 'controllers', 'student.controller.js'),
];
const studentController = candidates.find(p => fs.existsSync(p));
const portalCandidates = [
  path.join(root, 'connectsukuu-frontend', 'student-portal.js'),
  path.join(root, 'frontend', 'student-portal.js'),
  path.join(root, 'student-portal.js'),
];
const studentPortal = portalCandidates.find(p => fs.existsSync(p));
if (!studentController || !studentPortal) {
  console.error('SAFE STOP: Could not identify both student.controller.js and student-portal.js under:', root);
  console.error('Run from the project root or pass the root path as the first argument. No files changed.');
  process.exit(2);
}

function backup(file) {
  const dest = `${file}.before-admin-final-fixes-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, dest);
  return dest;
}
function write(file, content) {
  const temp = `${file}.admin-final-fixes.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

let controller = fs.readFileSync(studentController, 'utf8');
let portal = fs.readFileSync(studentPortal, 'utf8');
let controllerChanged = false;
let portalChanged = false;

// Keep the student creation transaction bounded, but move slow password/PIN hashing
// outside the transaction where the source already has the compatible prepared hashes.
const createStart = controller.indexOf('async function createStudent(');
const createEnd = controller.indexOf('\nasync function ', createStart + 1);
if (createStart < 0 || createEnd < 0) {
  console.error('SAFE STOP: Could not identify the createStudent function. No files changed.');
  process.exit(3);
}
let createBlock = controller.slice(createStart, createEnd);

// If this source still performs bcrypt hashing inside the transaction, move it
// before the transaction. This is the main fix for the observed ~5.2s expiry.
if (!/const parentTemporaryPasswordCandidate\s*=/.test(createBlock) && /const temporaryStudentPin\s*=\s*generateStudentPin\(\);/.test(createBlock)) {
  const transactionStart = /([ \t]*)const result = await prisma\.\$transaction\(async \(tx\) => \{/;
  if (!transactionStart.test(createBlock)) {
    console.error('SAFE STOP: createStudent hashing is inside the transaction, but its transaction start did not match. No files changed.');
    process.exit(8);
  }
  const prepared = `\n        // Prepare password hashes before opening the transaction so bcrypt does not\n        // hold a database transaction open and trigger Prisma P2028 timeouts.\n        const temporaryStudentPin = generateStudentPin();\n        const parentTemporaryPasswordCandidate = cleanGuardianEmail\n          ? (cleanParentPassword || generateTemporaryPassword())\n          : null;\n        const [studentPinHash, parentPasswordHashCandidate] = await Promise.all([\n          bcrypt.hash(temporaryStudentPin, 10),\n          parentTemporaryPasswordCandidate\n            ? bcrypt.hash(parentTemporaryPasswordCandidate, 10)\n            : Promise.resolve(null),\n        ]);\n`;
  createBlock = createBlock.replace(transactionStart, (m, indent) => `${prepared}\n${indent}const result = await prisma.$transaction(async (tx) => {`);
  const pinHashBlock = /\n[ \t]*const temporaryStudentPin = generateStudentPin\(\);\s*\n[ \t]*const studentPinHash = await bcrypt\.hash\(temporaryStudentPin, 10\);/;
  if (!pinHashBlock.test(createBlock)) {
    console.error('SAFE STOP: Could not identify the in-transaction student PIN hashing block. No files changed.');
    process.exit(9);
  }
  createBlock = createBlock.replace(pinHashBlock, '');
  const parentHashBlock = /parentTemporaryPassword\s*=\s*cleanParentPassword\s*\|\|\s*generateTemporaryPassword\(\);\s*const parentPasswordHash = await bcrypt\.hash\(\s*parentTemporaryPassword,\s*10\s*\);/;
  if (!parentHashBlock.test(createBlock)) {
    console.error('SAFE STOP: Could not identify the in-transaction parent password hashing block. No files changed.');
    process.exit(10);
  }
  createBlock = createBlock.replace(parentHashBlock, 'parentTemporaryPassword = parentTemporaryPasswordCandidate;\n            const parentPasswordHash = parentPasswordHashCandidate;');
  controllerChanged = true;
}

if (!/maxWait\s*:\s*10000\s*,\s*timeout\s*:\s*20000/.test(createBlock)) {
  // Only patch the transaction closure immediately before the 201 response.
  const responseAnchor = /\n([ \t]*)\}\s*\);\s*\n([ \t]*)return res\.status\(201\)\.json\(result\);/;
  if (!responseAnchor.test(createBlock)) {
    console.error('SAFE STOP: createStudent transaction closure did not match the expected source. No files changed.');
    process.exit(4);
  }
  createBlock = createBlock.replace(responseAnchor, '\n$1}, { maxWait: 10000, timeout: 20000 });\n$2return res.status(201).json(result);');
  controllerChanged = true;
}
if (controllerChanged) {
  controller = controller.slice(0, createStart) + createBlock + controller.slice(createEnd);
}

// Bulk permanent deletion performs multiple related deletes in one transaction.
// Give that single transaction a bounded 20-second execution window rather than
// allowing Prisma's 5-second default to close it midway through cleanup.
const bulkStart = controller.indexOf('async function permanentlyDeleteStudentsBulk(');
const bulkEnd = controller.indexOf('\nasync function ', bulkStart + 1);
if (bulkStart < 0 || bulkEnd < 0) {
  console.error('SAFE STOP: Could not identify permanentlyDeleteStudentsBulk. No files changed.');
  process.exit(5);
}
let bulkBlock = controller.slice(bulkStart, bulkEnd);
if (!/maxWait\s*:\s*10000\s*,\s*timeout\s*:\s*20000/.test(bulkBlock)) {
  const successAnchor = /\n([ \t]*)\}\s*\);\s*\n([ \t]*)res\.json\(\{\s*\n\s*success: true,/;
  if (!successAnchor.test(bulkBlock)) {
    console.error('SAFE STOP: Bulk deletion transaction closure did not match the expected source. No files changed.');
    process.exit(6);
  }
  bulkBlock = bulkBlock.replace(successAnchor, '\n$1}, { maxWait: 10000, timeout: 20000 });\n$2res.json({\n        success: true,');
  controller = controller.slice(0, bulkStart) + bulkBlock + controller.slice(bulkEnd);
  controllerChanged = true;
}

// Resolve stored /uploads/... paths against the API origin, not the frontend
// dev-server origin. Absolute URLs (used by student self-upload) remain intact.
if (!/function photoSrc\(/.test(portal)) {
  const apiLine = /^(const API=.*?;\s*)$/m;
  if (!apiLine.test(portal)) {
    console.error('SAFE STOP: Could not locate the student portal API constant. No files changed.');
    process.exit(7);
  }
  portal = portal.replace(apiLine, `$1\nfunction photoSrc(value) {\n  const raw = String(value || '').trim();\n  if (!raw) return '';\n  if (/^https?:\\/\\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;\n  return API + (raw.startsWith('/') ? raw : '/' + raw);\n}`);
  portalChanged = true;
}
const oldPortal = portal;
portal = portal.replaceAll('esc(student.photoUrl)', 'esc(photoSrc(student.photoUrl))');
portal = portal.replaceAll('photo.src=student.photoUrl', 'photo.src=photoSrc(student.photoUrl)');
if (portal !== oldPortal) portalChanged = true;

if (!controllerChanged && !portalChanged) {
  console.log('No changes needed: both fixes already appear to be applied.');
  process.exit(0);
}
const backups = [];
if (controllerChanged) backups.push([studentController, backup(studentController)]);
if (portalChanged) backups.push([studentPortal, backup(studentPortal)]);
if (controllerChanged) write(studentController, controller);
if (portalChanged) write(studentPortal, portal);
console.log('Applied targeted repairs:');
if (controllerChanged) console.log(`- ${studentController}`);
if (portalChanged) console.log(`- ${studentPortal}`);
console.log('Backups created:');
for (const [file, copy] of backups) console.log(`- ${copy}`);
console.log('No schema, migration, database, billing, or other role files were changed.');
