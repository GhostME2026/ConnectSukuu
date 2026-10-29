const prisma = require('../config/db');
const { verifyToken } = require('../utils/jwt');

/*
 * Protects Student Portal API routes.
 *
 * Student JWTs are different from staff JWTs:
 * the JWT userId refers to Student.id,
 * not User.id.
 */
async function requireStudentAuth(req, res, next) {
  try {
    const authHeader =
    req.headers.authorization || '';
    
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }
    
    const token =
    authHeader.slice(7);
    
    const payload =
    verifyToken(token);
    
    if (
      payload.role !== 'STUDENT' ||
      !payload.userId ||
      !payload.schoolId
    ) {
      return res.status(401).json({
        error: 'Invalid student authentication',
      });
    }
    
    const student =
    await prisma.student.findFirst({
      where: {
        id: payload.userId,
        schoolId: payload.schoolId,
      },
      
      include: {
        access: true,
        school: true,
        
        parentRelationships: {
          include: {
            parent: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    
    if (!student) {
      return res.status(401).json({
        error: 'Student account not found',
      });
    }
    
    if (
      !student.access ||
      !student.access.enabled
    ) {
      return res.status(403).json({
        error: 'Student portal access is disabled',
      });
    }
    
    req.student = student;
    
    next();
  } catch (err) {
    console.error(
      'requireStudentAuth error:',
      err
    );
    
    return res.status(401).json({
      error: 'Invalid or expired student session',
    });
  }
}

module.exports = {
  requireStudentAuth,
};
