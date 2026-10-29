const prisma = require('../config/db');
const { schoolHasAccess } = require('../utils/trial');

// Applied to app routes (not billing/auth routes) so an expired trial school
// gets a clear "please subscribe" response instead of silently still working.
async function requireActiveSubscription(req, res, next) {
  if (req.user.role === 'SUPER_ADMIN') return next(); // platform admin isn't tied to a school

  const school = await prisma.school.findUnique({ where: { id: req.user.schoolId } });
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
