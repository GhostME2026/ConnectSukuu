const prisma = require('../config/db');
const { schoolHasAccess } = require('../utils/trial');

// Applied to app routes (not billing/auth routes) so an expired trial school
// gets a clear "please subscribe" response instead of silently still working.
// Short-lived cache so a burst of requests (contacts + messages + notifications) hits the database once.
const SCHOOL_TTL_MS = 15000;
const schoolCache = new Map();
const schoolInflight = new Map();
async function loadSchool(id) {
  const hit = schoolCache.get(id);
  if (hit && hit.exp > Date.now()) return hit.school;
  if (schoolInflight.has(id)) return schoolInflight.get(id);
  const p = prisma.school.findUnique({ where: { id } }).then((school) => {
    if (school) {
      if (schoolCache.size > 500) schoolCache.clear();
      schoolCache.set(id, { school, exp: Date.now() + SCHOOL_TTL_MS });
    }
    return school;
  }).finally(() => schoolInflight.delete(id));
  schoolInflight.set(id, p);
  return p;
}

async function requireActiveSubscription(req, res, next) {
  if (req.user.role === 'SUPER_ADMIN') return next(); // platform admin isn't tied to a school

  let school;
  try { school = await loadSchool(req.user.schoolId); }
  catch (e) { console.error('requireActiveSubscription:', e); return res.status(500).json({ error: 'Unable to verify subscription.' }); }
  if (!school) return res.status(404).json({ error: 'School not found' });

  if (!schoolHasAccess(school)) {
    return res.status(402).json({
      error: 'Your free trial has ended. Please subscribe to continue using ConnectSukuu.',
    });
  }

  req.school = school;
  next();
}

module.exports = { requireActiveSubscription };
