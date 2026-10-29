const prisma = require('../config/db');
const crypto = require('crypto');

const OWNER_ONLY = ['OWNER'];
const SCHOOL_TYPES = new Set(['CRECHE','KG','PRIMARY','SECONDARY','PRIMARY_SECONDARY','VOCATIONAL','UNIVERSITY','OTHER']);
function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function normalizeCode(value) { return clean(value).toUpperCase(); }
async function makeBranchCode(requested, exceptId = null) {
  const wanted = normalizeCode(requested);
  if (wanted) {
    if (!/^[A-Z0-9]{3,6}$/.test(wanted)) throw new Error('Branch school code must be 3–6 letters or numbers.');
    const existing = await prisma.branch.findUnique({ where: { code: wanted }, select: { id: true } });
    if (existing && existing.id !== exceptId) throw new Error('That branch school code is already in use.');
    const schoolCode = await prisma.school.findUnique({ where: { code: wanted }, select: { id: true } });
    if (schoolCode) throw new Error('That code is already used as a school-wide sign-in code. Choose another branch code.');
    if (existing && existing.id === exceptId) return wanted;
    return wanted;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!(await prisma.branch.findUnique({ where: { code: candidate }, select: { id: true } })) && !(await prisma.school.findUnique({ where: { code: candidate }, select: { id: true } }))) return candidate;
  }
  throw new Error('Could not generate a unique branch school code. Please try again.');
}
function ownerOnly(req, res) {
  if (!OWNER_ONLY.includes(req.user.role)) { res.status(403).json({ error: 'Only the Owner can manage branches.' }); return false; }
  return true;
}

async function branchStats(branch) {
  const [students, staff, fees] = await Promise.all([
    prisma.student.count({ where: { schoolId: branch.schoolId, branchId: branch.id, status: { not: 'INACTIVE' } } }),
    prisma.user.count({ where: { schoolId: branch.schoolId, branchId: branch.id, role: { notIn: ['OWNER','SUPER_ADMIN','STUDENT','PARENT'] }, isActive: true } }),
    prisma.studentFee.findMany({
      where: { schoolId: branch.schoolId, student: { branchId: branch.id } },
      select: { amount: true, payments: { select: { amount: true, allocations: { select: { amount: true } } } }, paymentAllocations: { select: { amount: true } } }
    })
  ]);
  let billed = 0, collected = 0;
  for (const fee of fees) { billed += Number(fee.amount || 0); collected += (fee.payments || []).reduce((sum, p) => sum + (!(p.allocations || []).length ? Number(p.amount || 0) : 0), 0) + (fee.paymentAllocations || []).reduce((sum, a) => sum + Number(a.amount || 0), 0); }
  return { students, staff, billed, collected, outstanding: Math.max(0, billed - collected), collectionRate: billed > 0 ? Math.min(100, Math.round(collected / billed * 1000) / 10) : 0 };
}

async function listBranches(req, res) {
  try {
    const where = { schoolId: req.user.schoolId };
    if (req.user.role !== 'OWNER') where.id = req.user.branchId || '__NO_BRANCH__';
    const branches = await prisma.branch.findMany({ where, orderBy: { createdAt: 'asc' } });
    const result = await Promise.all(branches.map(async b => ({ ...b, stats: await branchStats(b), leadership: await prisma.user.findMany({ where: { schoolId: req.user.schoolId, branchId: b.id, isActive: true, role: { in: ['ADMINISTRATOR','HEAD_TEACHER'] } }, select: { id:true, firstName:true,lastName:true,email:true,role:true } }) })));
    res.json(result);
  } catch (err) { console.error('listBranches:', err); res.status(500).json({ error: 'Unable to load branches.' }); }
}

async function createBranch(req, res) {
  if (!ownerOnly(req, res)) return;
  const name = clean(req.body.name), schoolType = clean(req.body.schoolType || 'OTHER').toUpperCase();
  const country = clean(req.body.country), region = clean(req.body.region), city = clean(req.body.city), address = clean(req.body.address);
  const estimatedStudentCount = Number(req.body.estimatedStudentCount || 0);
  if (!name || !country || !region || !city) return res.status(400).json({ error: 'Branch name, country, region and city/town are required.' });
  if (!SCHOOL_TYPES.has(schoolType)) return res.status(400).json({ error: 'Choose a valid school type.' });
  if (!Number.isInteger(estimatedStudentCount) || estimatedStudentCount < 0) return res.status(400).json({ error: 'Estimated student count must be a non-negative whole number.' });
  try {
    const existingCount = await prisma.branch.count({ where: { schoolId: req.user.schoolId } });
    const settings = await prisma.schoolSettings.findUnique({ where: { schoolId: req.user.schoolId } });
    if (existingCount > 0 && !settings?.multiCampusEnabled) return res.status(403).json({ error: 'Multi-campus management is disabled. Enable it in School Settings before creating another branch.' });
    const exists = await prisma.branch.findFirst({ where: { schoolId: req.user.schoolId, name: { equals: name, mode: 'insensitive' } } });
    if (exists) return res.status(409).json({ error: 'A branch with this name already exists.' });
    let code; try { code = await makeBranchCode(req.body.code); } catch (err) { return res.status(400).json({ error: err.message }); }
    const branch = await prisma.branch.create({ data: { schoolId: req.user.schoolId, name, code, schoolType, estimatedStudentCount, country, region, city, address, phone: clean(req.body.phone) || null, contactEmail: clean(req.body.contactEmail).toLowerCase() || null } });
    res.status(201).json({ ...branch, stats: await branchStats(branch), leadership: [] });
  } catch (err) { console.error('createBranch:', err); res.status(500).json({ error: 'Unable to create branch.' }); }
}

async function getBranch(req, res) {
  try {
    const branch = await prisma.branch.findFirst({ where: { id: req.params.id, schoolId: req.user.schoolId } });
    if (!branch) return res.status(404).json({ error: 'Branch not found.' });
    if (req.user.role !== 'OWNER' && req.user.branchId !== branch.id) return res.status(403).json({ error: 'This branch is outside your assignment.' });
    const leadership = await prisma.user.findMany({ where: { schoolId: req.user.schoolId, branchId: branch.id, isActive: true, role: { in: ['ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS','ACCOUNTANT','NURSE'] } }, select: { id:true,firstName:true,lastName:true,email:true,role:true,isActive:true } });
    res.json({ ...branch, stats: await branchStats(branch), leadership });
  } catch (err) { console.error('getBranch:', err); res.status(500).json({ error: 'Unable to load branch details.' }); }
}

async function updateBranch(req, res) {
  if (!ownerOnly(req, res)) return;
  const data = {};
  for (const key of ['name','country','region','city','address','phone','contactEmail','status','schoolType']) if (req.body[key] !== undefined) data[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
  if (req.body.code !== undefined) { try { data.code = await makeBranchCode(req.body.code, req.params.id); } catch (err) { return res.status(400).json({ error: err.message }); } }
  if (req.body.estimatedStudentCount !== undefined) data.estimatedStudentCount = Number(req.body.estimatedStudentCount);
  if (data.name !== undefined && !data.name) return res.status(400).json({ error: 'Branch name cannot be blank.' });
  if (data.status !== undefined && !['ACTIVE','INACTIVE'].includes(data.status)) return res.status(400).json({ error: 'Branch status must be ACTIVE or INACTIVE.' });
  if (data.schoolType !== undefined) data.schoolType = String(data.schoolType).toUpperCase();
  if (data.contactEmail !== undefined) data.contactEmail = data.contactEmail.toLowerCase() || null;
  try {
    const current = await prisma.branch.findFirst({ where: { id: req.params.id, schoolId: req.user.schoolId } });
    if (!current) return res.status(404).json({ error: 'Branch not found.' });
    const updated = await prisma.branch.update({ where: { id: current.id }, data });
    res.json({ ...updated, stats: await branchStats(updated) });
  } catch (err) { console.error('updateBranch:', err); res.status(500).json({ error: 'Unable to update branch.' }); }
}

async function deleteBranch(req, res) {
  if (!ownerOnly(req, res)) return;
  try {
    const branch = await prisma.branch.findFirst({ where: { id: req.params.id, schoolId: req.user.schoolId } });
    if (!branch) return res.status(404).json({ error: 'Branch not found.' });
    const [students, users, announcements, messages, tickets] = await Promise.all([
      prisma.student.count({ where: { schoolId: req.user.schoolId, branchId: branch.id } }),
      prisma.user.count({ where: { schoolId: req.user.schoolId, branchId: branch.id } }),
      prisma.announcement.count({ where: { schoolId: req.user.schoolId, branchId: branch.id } }),
      prisma.directMessage.count({ where: { schoolId: req.user.schoolId, branchId: branch.id } }),
      prisma.supportTicket.count({ where: { schoolId: req.user.schoolId, branchId: branch.id } })
    ]);
    const linked = { students, staffAccounts: users, announcements, messages, supportRequests: tickets };
    if (Object.values(linked).some(n => n > 0)) {
      return res.status(409).json({ error: 'This branch has linked records and cannot be permanently deleted. Deactivate it instead to preserve history.', linkedRecords: linked });
    }
    await prisma.branch.delete({ where: { id: branch.id } });
    return res.json({ success: true, deleted: true, branchId: branch.id });
  } catch (err) {
    console.error('deleteBranch:', err);
    return res.status(500).json({ error: 'Unable to delete this branch. If it has linked records, deactivate it instead.' });
  }
}

module.exports = { listBranches, createBranch, getBranch, updateBranch, deleteBranch };
