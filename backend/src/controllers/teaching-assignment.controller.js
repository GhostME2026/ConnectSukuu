const { Prisma } = require('@prisma/client');
const prisma = require('../config/db');

const ALLOWED_ASSIGNMENT_TYPES = [
  'PRIMARY',
'ASSISTANT',
'SUBSTITUTE',
];

/**
 * GET /api/teaching-assignments
 *
 * Lists teacher assignments for the authenticated school.
 *
 * Optional filters:
 *   ?academicYearId=
 *   ?classId=
 *   ?subjectId=
 *   ?teacherId=
 *
 * Teachers are restricted to seeing their own assignments.
 */
async function listTeachingAssignments(req, res) {
  try {
    const {
      academicYearId,
      classId,
      subjectId,
      teacherId,
    } = req.query;
    
    const where = {
      schoolId: req.user.schoolId,
    };
    
    if (academicYearId) {
      where.academicYearId = academicYearId;
    }
    
    if (classId) {
      where.classId = classId;
    }
    
    if (subjectId) {
      where.subjectId = subjectId;
    }
    
    //A teacher can only see their own assignments.
    if (req.user.role === 'TEACHER') {
      where.teacherId = req.user.id;
    } else if (teacherId) {
      where.teacherId = teacherId;
    }
    
    const assignments = await prisma.teachingAssignment.findMany({
      where,
      include: {
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
        schoolClass: {
          select: {
            id: true,
            name: true,
            level: true,
            section: true,
          },
        },
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        academicYear: {
          select: {
            id: true,
            name: true,
            isCurrent: true,
          },
        },
      },
      orderBy: [
        { academicYear: { startsAt: 'desc' } },
        { schoolClass: { name: 'asc' } },
        { subject: { name: 'asc' } },
        { assignmentType: 'asc' },
        { teacher: { lastName: 'asc' } },
      ],
    });
    
    res.json(assignments);
  } catch (err) {
    console.error('listTeachingAssignments error:', err);
    res.status(500).json({
      error: 'Failed to load teaching assignments',
    });
  }
}


/**
 * GET /api/teaching-assignments/teachers
 *
 * Returns teachers belonging to the authenticated school.
 *
 * Only Head Teacher and Head of Academics should use this
 */
async function listTeachers(req, res) {
  try {
    const teachers = await prisma.user.findMany({
      where: {
        schoolId: req.user.schoolId,
        role: 'TEACHER',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
      },
      orderBy: [
        { lastName: 'asc' },
        { firstName: 'asc' },
      ],
    });
    
    res.json(teachers);
  } catch (err) {
    console.error('listTeachers error:', err);
    res.status(500).json({
      error: 'Failed to load teachers',
    });
  }
}


/**
 *Validate the academic year, class and subject relationship.
 */
async function validateAssignmentTarget({
  schoolId,
  academicYearId,
  classId,
  subjectId,
}) {
  const schoolClass = await prisma.schoolClass.findFirst({
    where: {
      id: classId,
      schoolId,
      academicYearId,
    },
    include: {
      academicYear: true,
    },
  });
  
  if (!schoolClass) {
    return {
      error: 'Class not found for the selected academic year',
      status: 404,
    };
  }
  
  const subject = await prisma.subject.findFirst({
    where: {
      id: subjectId,
      schoolId,
    },
  });
  
  if (!subject) {
    return {
      error: 'Subject not found',
      status: 404,
    };
  }
  
  //A subject must first be assigned to the class
  //through ClassSubject before a teacher can teach it.
  const classSubject = await prisma.classSubject.findFirst({
    where: {
      schoolId,
      academicYearId,
      classId,
      subjectId,
    },
  });
  
  if (!classSubject) {
    return {
      error:
      'This subject has not been assigned to the selected class yet',
      status: 400,
    };
  }
  
  return {
    schoolClass,
    subject,
  };
}


/**
 * Create a teacher assignment.
 *
 * Supports:
 *   PRIMARY
 *   ASSISTANT
 *   SUBSTITUTE
 */
async function createTeachingAssignment(req, res) {
  const {
    academicYearId,
    classId,
    subjectId,
    teacherId,
    assignmentType = 'PRIMARY',
  } = req.body;
  
  if (
    !academicYearId ||
    !classId ||
    !subjectId ||
    !teacherId
  ) {
    return res.status(400).json({
      error:
      'Academic year, class, subject and teacher are required',
    });
  }
  
  const normalizedType = String(assignmentType)
  .trim()
  .toUpperCase();
  
  if (!ALLOWED_ASSIGNMENT_TYPES.includes(normalizedType)) {
    return res.status(400).json({
      error:
      'Invalid assignment type. Allowed types: PRIMARY, ASSISTANT, SUBSTITUTE',
    });
  }
  
  try {
    const validation = await validateAssignmentTarget({
      schoolId: req.user.schoolId,
      academicYearId,
      classId,
      subjectId,
    });
    
    if (validation.error) {
      return res.status(validation.status).json({
        error: validation.error,
      });
    }
    
    const teacher = await prisma.user.findFirst({
      where: {
        id: teacherId,
        schoolId: req.user.schoolId,
        role: 'TEACHER',
      },
    });
    
    if (!teacher) {
      return res.status(404).json({
        error:
        'Teacher not found or the selected user is not a teacher',
      });
    }
    
    /*
     * SERIALIZABLE prevents two simultaneous PRIMARY assignments
     * from both passing the "already exists" check.
     */
    const assignment = await prisma.$transaction(
      async (tx) => {
        if (normalizedType === 'PRIMARY') {
          const existingPrimary =
          await tx.teachingAssignment.findFirst({
            where: {
              schoolId: req.user.schoolId,
              academicYearId,
              classId,
              subjectId,
              assignmentType: 'PRIMARY',
            },
          });
          
          if (existingPrimary) {
            throw new Error(
              'PRIMARY_ASSIGNMENT_ALREADY_EXISTS'
            );
          }
        }
        
        return tx.teachingAssignment.create({
          data: {
            schoolId: req.user.schoolId,
            academicYearId,
            classId,
            subjectId,
            teacherId,
            assignmentType: normalizedType,
          },
          include: {
            teacher: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            schoolClass: {
              select: {
                id: true,
                name: true,
                level: true,
                section: true,
              },
            },
            subject: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            academicYear: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
          },
        });
      },
      {
        isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
      }
    );
    
    res.status(201).json(assignment);
  } catch (err) {
    if (
      err.message === 'PRIMARY_ASSIGNMENT_ALREADY_EXISTS'
    ) {
      return res.status(409).json({
        error:
        'A primary teacher is already assigned to this class and subject',
      });
    }
    
    if (err.code === 'P2002') {
      return res.status(409).json({
        error:
        'This teacher is already assigned to this class and subject',
      });
    }
    
    if (err.code === 'P2034') {
      return res.status(409).json({
        error:
        'Another assignment was created at the same time. Please try again.',
      });
    }
    
    console.error('createTeachingAssignment error:', err);
    
    res.status(500).json({
      error: 'Failed to create teaching assignment',
    });
  }
}


/**
 * Currently allows changing the assignment type.
 *
 * Example:
 * PRIMARY → SUBSTITUTE
 */
async function updateTeachingAssignment(req, res) {
  const { id } = req.params;
  const { assignmentType } = req.body;
  
  if (!assignmentType) {
    return res.status(400).json({
      error: 'Assignment type is required',
    });
  }
  
  const normalizedType = String(assignmentType)
  .trim()
  .toUpperCase();
  
  if (!ALLOWED_ASSIGNMENT_TYPES.includes(normalizedType)) {
    return res.status(400).json({
      error:
      'Invalid assignment type. Allowed types: PRIMARY, ASSISTANT, SUBSTITUTE',
    });
  }
  
  try {
    const existing = await prisma.teachingAssignment.findFirst({
      where: {
        id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!existing) {
      return res.status(404).json({
        error: 'Teaching assignment not found',
      });
    }
    
    const updated = await prisma.$transaction(
      async (tx) => {
        if (normalizedType === 'PRIMARY') {
          const existingPrimary =
          await tx.teachingAssignment.findFirst({
            where: {
              schoolId: req.user.schoolId,
              academicYearId: existing.academicYearId,
              classId: existing.classId,
              subjectId: existing.subjectId,
              assignmentType: 'PRIMARY',
              NOT: {
                id,
              },
            },
          });
          
          if (existingPrimary) {
            throw new Error(
              'PRIMARY_ASSIGNMENT_ALREADY_EXISTS'
            );
          }
        }
        
        return tx.teachingAssignment.update({
          where: { id },
          data: {
            assignmentType: normalizedType,
          },
          include: {
            teacher: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            schoolClass: {
              select: {
                id: true,
                name: true,
                level: true,
                section: true,
              },
            },
            subject: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            academicYear: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
          },
        });
      },
      {
        isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
      }
    );
    
    res.json(updated);
  } catch (err) {
    if (
      err.message === 'PRIMARY_ASSIGNMENT_ALREADY_EXISTS'
    ) {
      return res.status(409).json({
        error:
        'A primary teacher is already assigned to this class and subject',
      });
    }
    
    if (err.code === 'P2034') {
      return res.status(409).json({
        error:
        'Another assignment was changed at the same time. Please try again.',
      });
    }
    
    console.error('updateTeachingAssignment error:', err);
    
    res.status(500).json({
      error: 'Failed to update teaching assignment',
    });
  }
}


/**
 * DELETE /api/teaching-assignments/:id
 */
async function deleteTeachingAssignment(req, res) {
  const { id } = req.params;
  
  try {
    const existing = await prisma.teachingAssignment.findFirst({
      where: {
        id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!existing) {
      return res.status(404).json({
        error: 'Teaching assignment not found',
      });
    }
    
    await prisma.teachingAssignment.delete({
      where: { id },
    });
    
    res.json({
      message: 'Teaching assignment removed successfully',
    });
  } catch (err) {
    console.error('deleteTeachingAssignment error:', err);
    
    res.status(500).json({
      error: 'Failed to delete teaching assignment',
    });
  }
}


module.exports = {
  listTeachingAssignments,
  listTeachers,
  createTeachingAssignment,
  updateTeachingAssignment,
  deleteTeachingAssignment,
};
