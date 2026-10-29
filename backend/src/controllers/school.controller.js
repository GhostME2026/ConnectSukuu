const prisma = require('../config/db');

// GET /api/schools/me — any logged-in staff member. Powers the trial banner
// and plan/status stats on the dashboard.
async function getMySchool(req, res) {
  const school = await prisma.school.findUnique({ where: { id: req.user.schoolId } });
  if (!school) return res.status(404).json({ error: 'School not found' });

  res.json({
    name: school.name,
    slug: school.slug,
    plan: school.plan,
    subscriptionStatus: school.subscriptionStatus,
    trialEndsAt: school.trialEndsAt,
    billingCycle: school.billingCycle,
    subscriptionRenewsAt: school.subscriptionRenewsAt,
    subscriptionExempt: school.subscriptionExempt,
    subscriptionExemptReason: school.subscriptionExemptReason,
  });
}

module.exports = { getMySchool };
