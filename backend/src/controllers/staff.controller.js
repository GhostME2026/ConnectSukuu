const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/db');

//Roles the OWNER is responsible for creating/managing.
const OWNER_MANAGED_ROLES = [
  'HEAD_TEACHER',
'ADMINISTRATOR',
];

// Roles the HEAD_TEACHER is responsible for creating/managing.
const HEAD_TEACHER_MANAGED_ROLES = [
  'HEAD_OF_ACADEMICS',
'ACCOUNTANT',
'TEACHER',
'NURSE',
'SECURITY',
];

// Combines list of roles that can be created through this endpoint.
const ASSIGNABLE_ROLES = [
  ...OWNER_MANAGED_ROLES,
...HEAD_TEACHER_MANAGED_ROLES,
];

/**
 * Determines whether the currently logged-in user
 * is allowed to manage/create a particular role.
 */
function canManageStaffRole(actorRole, targetRole) {
  if (actorRole === 'OWNER') {
    return OWNER_MANAGED_ROLES.includes(targetRole);
  }
  
  if (actorRole === 'HEAD_TEACHER') {
    return HEAD_TEACHER_MANAGED_ROLES.includes(targetRole);
  }
  
  return false;
}

/**
 * Generate a temporary password for a newly created staff member.
 *
 * Later, the first-login flow will force the user to change it.
 */
function generateTempPassword() {
  return crypto.randomBytes(6).toString('base64url');
}


/**
 * GET /api/staff
 * Lists staff belonging to the authenticated user's school.
 *
 * PARENT and STUDENT accounts are excluded.
 */
async function listStaff(req, res) {
  try {
    const staff = await prisma.user.findMany({
      where: {
        schoolId: req.user.schoolId,
        role: { notIn: ['PARENT', 'STUDENT'] },
        ...(req.user.role === 'OWNER' ? {} : { branchId: req.user.branchId || '__NO_BRANCH__' }),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        branchId: true,
        isActive: true,
        deactivatedAt: true,
        branch: { select: { id: true, name: true, status: true } },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    
    res.json(staff);
  } catch (err) {
    console.error('listStaff error:', err);
    
    res.status(500).json({
      error: 'Failed to load staff',
    });
  }
}


/**
 * POST /api/staff
 * Creates a staff account.
 *
 * OWNER:
 *   HEAD_TEACHER
 *   ADMINISTRATOR
 *
 * HEAD_TEACHER:
 *   HEAD_OF_ACADEMICS
 *   ACCOUNTANT
 *   TEACHER
 *   NURSE
 *   SECURITY
 */
async function inviteStaff(req, res) {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      role,
      password,
      branchId: requestedBranchId,
    } = req.body;
    
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !role) {
      return res.status(400).json({
        error: 'First name, last name, email and role are required',
      });
    }
    
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role for a staff account',
      });
    }
    
    /*
     * Enforce the ConnectSukuu role hierarchy at controller level.
     *
     * OWNER:
     *   ADMINISTRATOR
     *   HEAD_TEACHER
     *
     * HEAD_TEACHER:
     *   HEAD_OF_ACADEMICS
     *   ACCOUNTANT
     *   TEACHER
     *   NURSE
     *   SECURITY
     */
    if (!canManageStaffRole(req.user.role, role)) {
      return res.status(403).json({ error: 'You do not have permission to create this staff role' });
    }

    const branchId = req.user.role === 'OWNER' ? requestedBranchId : req.user.branchId;
    if (!branchId) return res.status(400).json({ error: 'Create or select a branch before creating a staff account.' });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, schoolId: req.user.schoolId, status: 'ACTIVE' } });
    if (!branch) return res.status(400).json({ error: 'Choose an active branch belonging to this school.' });
    if (req.user.role === 'HEAD_TEACHER' && req.user.branchId !== branchId) return res.status(403).json({ error: 'You can only create staff for your assigned branch.' });
    if (['ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS','ACCOUNTANT','NURSE'].includes(role)) {
      const occupied = await prisma.user.findFirst({ where: { schoolId: req.user.schoolId, branchId, role, isActive: true } });
      if (occupied) return res.status(409).json({ error: `This branch already has an active ${role.replaceAll('_',' ').toLowerCase()} account. Deactivate or reassign the existing account first.` });
    }
    
    const normalizedEmail = email.trim().toLowerCase();
    
    const existing = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });
    
    if (existing) {
      return res.status(409).json({
        error: 'An account with this email already exists',
      });
    }
    
    /*
     * Password behaviour:
     *
     * 1. Administrator/authorized user supplies a password:
     *    use that exact password temporarily.
     *
     * 2. Password is blank:
     *    securely generate a temporary password.
     */
    const suppliedPassword =
    typeof password === 'string'
    ? password.trim()
    : '';
    
    if (suppliedPassword && suppliedPassword.length < 8) {
      return res.status(400).json({
        error: 'Temporary password must be at least 8 characters',
      });
    }
    
    const tempPassword =
    suppliedPassword || generateTempPassword();
    
    const passwordHash = await bcrypt.hash(
      tempPassword,
      10
    );
    
    const user = await prisma.user.create({
      data: {
        firstName: firstName.trim(),
                                          lastName: lastName.trim(),
                                          email: normalizedEmail,
                                          phone: phone?.trim() || null,
                                          role,
                                          passwordHash,
                                          mustChangePassword: true,
                                          schoolId: req.user.schoolId,
                                          branchId,
                                          isActive: true,
      },
    });
    
    /*
     * The temporary password is returned once.
     * Only the hash is stored in the database.
     */
    return res.status(201).json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      tempPassword,
    });
  } catch (error) {
    console.error('inviteStaff error:', error);
    
    /*
     * Prisma unique constraint protection.
     */
    if (error?.code === 'P2002') {
      return res.status(409).json({
        error: 'An account with this email already exists',
      });
    }
    
    return res.status(500).json({
      error: 'Failed to create staff account',
    });
  }
}


/**
 * PATCH /api/staff/:id
 *
 * Changes a staff member's role.
 * 1. The actor must be allowed to manage the existing role.
 * 2. The actor must be allowed to assign the new role.
 */
async function updateStaffRole(req, res) {
  const { role } = req.body;
  const requestedBranchId = req.body.branchId;
  
  if (!role || !ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({
      error: 'Invalid role for a staff account',
    });
  }
  
  const target = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!target) {
    return res.status(404).json({ error: 'Staff member not found' });
  }
  if (req.user.role === 'HEAD_TEACHER' && target.branchId !== req.user.branchId) return res.status(403).json({ error: 'You can only manage staff in your assigned branch.' });
  
  //OWNER cannot be modified through this endpoint.
  if (target.role === 'OWNER') {
    return res.status(403).json({
      error: 'The owner role cannot be changed here',
    });
  }
  
  //The actor must be allowed to manage the existing staff role.
  if (!canManageStaffRole(req.user.role, target.role)) {
    return res.status(403).json({
      error: 'You do not have permission to manage this staff member',
    });
  }
  
  //The actor must also be allowed to assign the new role.
  if (!canManageStaffRole(req.user.role, role)) {
    return res.status(403).json({ error: 'You do not have permission to assign this staff role' });
  }
  const branchId = req.user.role === 'OWNER' ? (requestedBranchId || target.branchId) : req.user.branchId;
  if (!branchId) return res.status(400).json({ error: 'A branch must be assigned before this account can operate.' });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, schoolId: req.user.schoolId, status: 'ACTIVE' } });
  if (!branch) return res.status(400).json({ error: 'Choose an active branch belonging to this school.' });
  if (target.branchId && target.branchId !== branchId) return res.status(409).json({ error: 'This account is already assigned to a branch. Branch transfers require a separate audited transfer workflow.' });
  if (req.user.role === 'HEAD_TEACHER' && (target.branchId !== req.user.branchId || branchId !== req.user.branchId)) return res.status(403).json({ error: 'You can only manage accounts within your assigned branch.' });
  if (['ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS','ACCOUNTANT','NURSE'].includes(role)) {
    const occupied = await prisma.user.findFirst({ where: { schoolId: req.user.schoolId, branchId, role, isActive: true, id: { not: target.id } } });
    if (occupied) return res.status(409).json({ error: `This branch already has an active ${role.replaceAll('_',' ').toLowerCase()} account.` });
  }
  
  const updated = await prisma.user.update({
    where: {
      id: target.id,
    },
    data: {
      role,
      branchId,
      isActive: true,
      deactivatedAt: null,
    },
  });
  
  res.json({
    id: updated.id,
    role: updated.role,
    branchId: updated.branchId,
  });
}


/**
 * PATCH /api/staff/:id/branch
 * Assigns an existing unassigned account to one branch without changing role
 * or deleting any historical records. An assigned account cannot be moved
 * through this endpoint; transfers require a separate audited workflow.
 */
async function assignStaffBranch(req, res) {
  if (req.user.role !== 'OWNER') return res.status(403).json({ error: 'Only the Owner can assign existing accounts to branches.' });
  const branchId = typeof req.body.branchId === 'string' ? req.body.branchId.trim() : '';
  if (!branchId) return res.status(400).json({ error: 'A branch must be selected.' });
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: req.user.schoolId } });
  if (!target) return res.status(404).json({ error: 'Staff member not found.' });
  if (target.role === 'OWNER' || target.role === 'SUPER_ADMIN' || target.role === 'STUDENT' || target.role === 'PARENT') return res.status(400).json({ error: 'This account type cannot be assigned through staff branch management.' });
  if (target.branchId && target.branchId !== branchId) return res.status(409).json({ error: 'This account already belongs to a branch. Transfers require a separate audited workflow.' });
  const branch = await prisma.branch.findFirst({ where: { id: branchId, schoolId: req.user.schoolId, status: 'ACTIVE' } });
  if (!branch) return res.status(400).json({ error: 'Choose an active branch belonging to this school.' });
  if (['ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS','ACCOUNTANT','NURSE'].includes(target.role)) {
    const occupied = await prisma.user.findFirst({ where: { schoolId: req.user.schoolId, branchId, role: target.role, isActive: true, id: { not: target.id } } });
    if (occupied && target.isActive) return res.status(409).json({ error: `This branch already has an active ${target.role.replaceAll('_',' ').toLowerCase()} account.` });
  }
  const updated = await prisma.user.update({ where: { id: target.id }, data: { branchId } });
  return res.json({ id: updated.id, role: updated.role, branchId: updated.branchId, isActive: updated.isActive });
}

async function reactivateStaff(req, res) {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, schoolId: req.user.schoolId } });
  if (!target) return res.status(404).json({ error: 'Staff member not found.' });
  if (target.role === 'OWNER' || target.role === 'SUPER_ADMIN') return res.status(403).json({ error: 'This account cannot be reactivated through staff management.' });
  if (req.user.role !== 'OWNER' && (!canManageStaffRole(req.user.role, target.role) || target.branchId !== req.user.branchId)) return res.status(403).json({ error: 'You do not have permission to reactivate this account.' });
  if (!target.branchId) return res.status(400).json({ error: 'Assign this account to a branch before reactivating it.' });
  const branch = await prisma.branch.findFirst({ where: { id: target.branchId, schoolId: req.user.schoolId, status: 'ACTIVE' } });
  if (!branch) return res.status(400).json({ error: 'The assigned branch is not active.' });
  if (['ADMINISTRATOR','HEAD_TEACHER','HEAD_OF_ACADEMICS','ACCOUNTANT','NURSE'].includes(target.role)) {
    const occupied = await prisma.user.findFirst({ where: { schoolId: req.user.schoolId, branchId: target.branchId, role: target.role, isActive: true, id: { not: target.id } } });
    if (occupied) return res.status(409).json({ error: `Another active ${target.role.replaceAll('_',' ').toLowerCase()} is already assigned to this branch.` });
  }
  const updated = await prisma.user.update({ where: { id: target.id }, data: { isActive: true, deactivatedAt: null } });
  return res.json({ id: updated.id, isActive: updated.isActive, branchId: updated.branchId });
}

/**
 * DELETE /api/staff/:id
 * Removes a staff member's access.
 */
async function removeStaff(req, res) {
  const target = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!target) {
    return res.status(404).json({ error: 'Staff member not found' });
  }
  if (req.user.role === 'HEAD_TEACHER' && target.branchId !== req.user.branchId) return res.status(403).json({ error: 'You can only manage staff in your assigned branch.' });
  
  //Never allow an Owner to be removed through this endpoint.
  if (target.role === 'OWNER') {
    return res.status(400).json({
      error: "The owner account can't be removed this way",
    });
  }
  
  //Enforce the staff hierarchy.
  if (!canManageStaffRole(req.user.role, target.role)) {
    return res.status(403).json({
      error: 'You do not have permission to remove this staff member',
    });
  }
  
  // Preserve the account's history and foreign-key relationships. This only revokes access.
  await prisma.user.update({ where: { id: target.id }, data: { isActive: false, deactivatedAt: new Date() } });
  
  res.json({ success: true, deactivated: true, preservedRecords: true });
}


module.exports = {
  listStaff,
  inviteStaff,
  updateStaffRole,
  removeStaff,
  assignStaffBranch,
  reactivateStaff,
  ASSIGNABLE_ROLES,
};
