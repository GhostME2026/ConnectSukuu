// Usage: router.post('/students', requireAuth, requireRole('OWNER', 'ADMINISTRATOR'), createStudent)
// This is the piece that actually enforces "administrator can enroll students
// but can't edit financial entries" — every route declares which roles may call it.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

module.exports = { requireRole };
