const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { signToken } = require('../utils/jwt');
const { thirtyDaysFromNow } = require('../utils/trial');
const authSecurity = require('./auth-security.controller');
const { sendWelcomeEmail } = require('../services/welcome-email.service');

// Database connectivity/pool failures are temporary service errors, not
// authentication failures. Returning 503 keeps clients from treating them
// as wrong credentials or clearing an otherwise valid session.
function isDatabaseUnavailable(err) {
  return Boolean(
    err &&
    (
      ['P1001', 'P1002', 'P1008', 'P2024', 'P2037'].includes(err.code) ||
      err.name === 'PrismaClientInitializationError' ||
      /Can't reach database server|Timed out fetching a new connection|connection pool/i.test(String(err.message || ''))
    )
  );
}
function databaseUnavailableResponse(res) {
  return res.status(503).json({
    error: 'The school database is temporarily unavailable. Please wait a moment and try again.',
    code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
    retryable: true,
  });
}

// Turns "Achimota Preparatory School" into
// "achimota-preparatory-school".
function slugify(name) {
  return name
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');
}

// POST /api/auth/signup-school
// Creates the School and its first OWNER account.
async function signupSchool(req, res) {
  try {
    const {
      schoolName,
      firstName,
      lastName,
      email,
      phone,
      password,
    } = req.body;
    
    if (
      !schoolName ||
      !firstName ||
      !lastName ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
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
    
    let slug = slugify(schoolName);
    
    const slugTaken = await prisma.school.findUnique({
      where: {
        slug,
      },
    });
    
    if (slugTaken) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const school = await prisma.school.create({
      data: {
        name: schoolName.trim(),
                                              slug,
                                              trialEndsAt: thirtyDaysFromNow(),
                                              
                                              users: {
                                                create: {
                                                  email: normalizedEmail,
                                                  phone: phone?.trim() || null,
                                              firstName: firstName.trim(),
                                              lastName: lastName.trim(),
                                              passwordHash,
                                              role: 'OWNER',
                                                },
                                              },
                                              
                                              settings: {
                                                create: {},
                                              },
      },
      
      include: {
        users: true,
      },
    });
    
    const owner = school.users[0];
    
    // Welcome email is best-effort: delivery failure must never undo a successful signup.
    void sendWelcomeEmail(owner, school);

    const token = signToken({
      userId: owner.id,
      schoolId: school.id,
      role: owner.role,
    });
    
    return res.status(201).json({
      token,
      
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        trialEndsAt: school.trialEndsAt,
      },
      
      user: {
        id: owner.id,
        email: owner.email,
        role: owner.role,
        schoolId: school.id,
        mustChangePassword: owner.mustChangePassword,
      },
    });
  } catch (err) {
    console.error('signupSchool error:', err);
    
    return res.status(500).json({
      error: 'Failed to create school account',
    });
  }
}

// POST /api/auth/login
// Every role logs in through this endpoint.
async function login(req, res) {
  try {
    const {
      schoolSlug,
      email,
      phone,
      password,
    } = req.body;
    
    if ((!email && !phone) || !password) {
      return res.status(400).json({
        error: 'Email or phone and password are required',
      });
    }
    
    const normalizedEmail = email
    ? email.trim().toLowerCase()
    : null;
    
    const normalizedPhone = phone
    ? phone.trim()
    : null;
    
    let user;
    
    if (normalizedEmail) {
      user = await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });
    } else {
      user = await prisma.user.findFirst({
        where: {
          phone: normalizedPhone,
        },
      });
    }
    
    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password',
      });
    }
    
    // SUPER_ADMIN has no school.
    // All other users belong to a school.
    if (user.role !== 'SUPER_ADMIN') {
      const school = await prisma.school.findUnique({
        where: {
          id: user.schoolId,
        },
      });
      
      if (!school) {
        return res.status(401).json({
          error: 'User school could not be found',
        });
      }
    }
    
    const valid = await bcrypt.compare(
      password,
      user.passwordHash
    );
    
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'This account is inactive. Contact your school Owner or administrator.' });
    }
    const branchRequiredRoles = ['HEAD_TEACHER','ADMINISTRATOR','HEAD_OF_ACADEMICS','ACCOUNTANT','TEACHER','NURSE','SECURITY'];
    if (branchRequiredRoles.includes(user.role)) {
      if (!user.branchId) return res.status(403).json({ error: 'This account has no branch assignment yet. Contact the school Owner before signing in.' });
      const assignedBranch = await prisma.branch.findFirst({ where: { id: user.branchId, schoolId: user.schoolId, status: 'ACTIVE' } });
      if (!assignedBranch) return res.status(403).json({ error: 'Your assigned branch is inactive or unavailable. Contact the school Owner.' });
    }
    
    const otpSettings = await prisma.otpPlatformSettings.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} });
    // Trusted-browser bypass is available only while global OTP is enabled.
    // A random browser token is HMAC-hashed before lookup; browser fingerprints are not trusted.
    let trustedBrowser = false;
    const rawTrustedToken = String(req.body.trustedDeviceToken || '').trim();
    if (otpSettings.enabled && user.role !== 'SUPER_ADMIN' && rawTrustedToken) {
      const crypto = require('crypto');
      const secret = String(process.env.JWT_SECRET || '').trim();
      if (secret) {
        const tokenHash = crypto.createHmac('sha256', secret).update(rawTrustedToken).digest('hex');
        const device = await prisma.trustedDevice.findFirst({
          where:{userId:user.id,tokenHash,revokedAt:null,expiresAt:{gt:new Date()}}
        });
        if (device) {
          trustedBrowser = true;
          await prisma.trustedDevice.update({where:{id:device.id},data:{lastUsedAt:new Date()}});
        }
      }
    }
    // Super Admin is the platform recovery/control account. Never gate this role
    // behind staff OTP. School-level OFF also means the school's staff use normal login.
    if (otpSettings.enabled && user.role !== 'SUPER_ADMIN' && !user.otpExempt && !trustedBrowser) {
      const schoolOtp = user.schoolId
        ? await prisma.otpSchoolSettings.findUnique({ where: { schoolId: user.schoolId } })
        : null;
      const schoolOtpEnabled = !schoolOtp || schoolOtp.enabled;
      if (schoolOtpEnabled) {
        // Prefer email, then SMS. The UI no longer asks users to choose a channel.
        const emailAllowed = Boolean(otpSettings.emailEnabled && (!schoolOtp || schoolOtp.emailEnabled) && user.email);
        const smsAllowed = Boolean(otpSettings.smsEnabled && (!schoolOtp || schoolOtp.smsEnabled) && user.phone);
        const channel = emailAllowed ? 'EMAIL' : smsAllowed ? 'SMS' : null;
        if (!channel) {
          return res.status(503).json({
            error: 'Staff OTP is enabled, but no permitted delivery method is configured for this account. Contact Super Admin.',
            code: 'OTP_DELIVERY_UNAVAILABLE'
          });
        }
        try {
          const challengeId = await authSecurity.beginLoginOtp(user, channel);
          return res.json({ otpRequired: true, challengeId, channel, message: 'A verification code has been sent.' });
        } catch (otpError) {
          console.error('login OTP delivery error:', otpError.message);
          return res.status(503).json({ error: 'Could not send your verification code. Check your contact details or contact support.' });
        }
      }
    }

    const token = signToken({
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
    });
    
    return res.json({
      token,
      
      requiresPasswordChange: user.mustChangePassword,
      
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        branchId: user.branchId,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
      },
    });
  } catch (err) {
    console.error('login error:', err);
    if (isDatabaseUnavailable(err)) return databaseUnavailableResponse(res);
    return res.status(500).json({ error: 'Failed to log in' });
  }
}

// POST /api/auth/change-password
// Allows an authenticated user to replace their current password.
async function changePassword(req, res) {
  try {
    const {
      currentPassword,
      newPassword,
    } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
      });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters long',
      });
    }
    
    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'New password must be different from the current password',
      });
    }
    
    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
    });
    
    if (!user) {
      return res.status(404).json({
        error: 'User account not found',
      });
    }

    const passwordPolicyError = validateNewPasswordForRole(newPassword, user.role);
    if (passwordPolicyError) return res.status(400).json({ error: passwordPolicyError });
    
    const valid = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );
    
    if (!valid) {
      return res.status(401).json({
        error: 'Current password is incorrect',
      });
    }
    
    const passwordHash = await bcrypt.hash(
      newPassword,
      10
    );
    
    await prisma.user.update({
      where: {
        id: user.id,
      },
      
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    
    return res.json({
      message: 'Password changed successfully',
    });
  } catch (err) {
    console.error('changePassword error:', err);
    
    return res.status(500).json({
      error: 'Failed to change password',
    });
  }
}
// POST /api/auth/student/login
// Authenticates a student using school code,
// admission number and PIN/password.
async function studentLogin(req, res) {
  try {
    const {
      schoolCode,
      admissionNumber,
      pin,
    } = req.body;
    
    if (!schoolCode || !admissionNumber || !pin) {
      return res.status(400).json({
        error:
        'School code, admission number and PIN/password are required',
      });
    }
    
    /*
     * School codes are stored in uppercase.
     */
    const normalizedSchoolCode =
    schoolCode.trim().toUpperCase();
    
    const normalizedAdmissionNumber =
    admissionNumber.trim();
    
    /*
     * Find the school using its short login code.
     */
    // Branch-specific codes are preferred. Legacy school-level codes remain valid.
    const loginBranch = await prisma.branch.findUnique({ where: { code: normalizedSchoolCode }, include: { school: true } });
    const school = loginBranch?.school || await prisma.school.findUnique({ where: { code: normalizedSchoolCode } });
    if (!school) return res.status(401).json({ error: 'Invalid school code, admission number or PIN/password' });

    const student = await prisma.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: school.id, admissionNumber: normalizedAdmissionNumber } },
      include: {
        access: true, school: true,
        parentRelationships: {
          include: { parent: { include: { user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } } } },
        },
      },
    });
    if (loginBranch && student && student.branchId !== loginBranch.id) {
      return res.status(401).json({ error: 'Invalid school code, admission number or PIN/password' });
    }

    if (!student || !student.access) {
      return res.status(401).json({ error: 'Invalid school code, admission number or PIN/password' });
    }
    if (!student.branchId) return res.status(403).json({ error: 'This student account has no branch assignment. Contact the school administration.' });
    const studentBranch = await prisma.branch.findFirst({ where: { id: student.branchId, schoolId: student.schoolId, status: 'ACTIVE' }, select: { id: true } });
    if (!studentBranch) return res.status(403).json({ error: 'The student’s branch is inactive. Contact the school administration.' });
    
    /*
     * Disabled student portal accounts cannot log in.
     */
    if (!student.access.enabled) {
      return res.status(403).json({
        error:
        'Student portal access is disabled',
      });
    }
    
    /*
     * Compare the supplied PIN/password against
     * the bcrypt hash stored in StudentAccess.
     */
    const validPermanentPin = await bcrypt.compare(pin, student.access.pinHash);
    const now = new Date();
    let validTemporaryPin = false;

    if (!validPermanentPin && student.access.temporaryPinHash &&
        student.access.temporaryPinExpiresAt && student.access.temporaryPinExpiresAt > now) {
      validTemporaryPin = await bcrypt.compare(pin, student.access.temporaryPinHash);
    }

    if (!validPermanentPin && !validTemporaryPin) {
      if (student.access.temporaryPinExpiresAt && student.access.temporaryPinExpiresAt <= now) {
        await prisma.studentAccess.updateMany({
          where: { studentId: student.id, temporaryPinExpiresAt: { lte: now } },
          data: { temporaryPinHash: null, temporaryPinExpiresAt: null },
        });
      }
      return res.status(401).json({ error: 'Invalid school code, admission number or PIN/password' });
    }

    if (validTemporaryPin) {
      // Conditional update makes the temporary PIN single-use, including concurrent attempts.
      const consumed = await prisma.studentAccess.updateMany({
        where: {
          studentId: student.id,
          temporaryPinHash: student.access.temporaryPinHash,
          temporaryPinExpiresAt: { gt: now },
        },
        data: {
          temporaryPinHash: null,
          temporaryPinExpiresAt: null,
          lastLoginAt: now,
        },
      });
      if (consumed.count !== 1) {
        return res.status(401).json({ error: 'This one-time PIN has expired or has already been used' });
      }
    } else {
      await prisma.studentAccess.update({
        where: { studentId: student.id },
        data: { lastLoginAt: now },
      });
    }
    
    /*
     * Student JWT.
     *
     * The userId contains the Student ID because
     * students authenticate through StudentAccess,
     * not through the User table.
     */
    const token = signToken({
      userId: student.id,
      schoolId: student.schoolId,
      role: 'STUDENT',
    });
    
    return res.json({
      token,
      
      student: {
        id: student.id,
        admissionNumber:
        student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        classLevel: student.classLevel,
        status: student.status,
        
        school: {
          id: student.school.id,
          name: student.school.name,
          code: student.school.code,
        },
        
        parents:
        student.parentRelationships.map(
          (relationship) => ({
            relationship:
            relationship.relationship,
            isPrimary:
            relationship.isPrimary,
            canReceiveNotifications:
            relationship.canReceiveNotifications,
            
            parent: {
              id:
              relationship.parent.id,
              
              firstName:
              relationship.parent.user.firstName,
              
              lastName:
              relationship.parent.user.lastName,
              
              phone:
              relationship.parent.user.phone,
              
              email:
              relationship.parent.user.email,
            },
          })
        ),
      },
    });
  } catch (err) {
    console.error('studentLogin error:', err);
    if (isDatabaseUnavailable(err)) return databaseUnavailableResponse(res);
    return res.status(500).json({ error: 'Unable to process student login' });
  }
}




// GET /api/auth/profile
async function getProfile(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, photoUrl: true, mustChangePassword: true }
    });
    if (!user) return res.status(404).json({ error: 'User account not found.' });
    return res.json({ user });
  } catch (err) {
    console.error('getProfile error:', err);
    return res.status(500).json({ error: 'Could not load your profile.' });
  }
}

// POST /api/auth/profile/photo
// Stores a profile photo for an authenticated staff/Owner account.
async function uploadProfilePhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a profile photo to upload.' });
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { photoUrl: `/uploads/staff-profiles/${req.file.filename}` },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, role: true, photoUrl: true }
    });
    return res.json({ user });
  } catch (err) {
    console.error('uploadProfilePhoto error:', err);
    return res.status(500).json({ error: 'Could not save the profile photo.' });
  }
}

module.exports = {
  signupSchool,
  login,
  studentLogin,
  changePassword,
  uploadProfilePhoto,
  getProfile,
};
