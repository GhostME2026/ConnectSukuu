const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/db');

// Runs on every protected route. Reads the "Authorization: Bearer <token>"
// header, checks it, and attaches the logged-in user to req.user so later
// middleware/controllers can use it.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    // One round trip: user + school archive flag + assigned branch (was three sequential queries).
    const found = await prisma.user.findUnique({ where: { id: decoded.userId }, include: { school: { select: { archivedAt: true } }, branch: { select: { id: true, schoolId: true, status: true } } } });
    const user = found;
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    if (user.isActive === false) return res.status(403).json({ error: 'This account is inactive.' });
    if (user.schoolId && user.school?.archivedAt) return res.status(403).json({ error: 'This school account is archived. Contact ConnectSukuu support for assistance.' });
    const branchRequiredRoles = ['HEAD_TEACHER','ADMINISTRATOR','HEAD_OF_ACADEMICS','ACCOUNTANT','TEACHER','NURSE','SECURITY'];
    if (branchRequiredRoles.includes(user.role)) {
      if (!user.branchId) return res.status(403).json({ error: 'A branch assignment is required before this account can operate.' });
      const branch = user.branch;
      if (!branch || branch.schoolId !== user.schoolId || branch.status !== 'ACTIVE') return res.status(403).json({ error: 'The assigned branch is inactive or unavailable.' });
    }
    delete user.branch; // keep req.user the same shape as before

    req.user = user; // { id, email, role, schoolId, branchId, ... }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
