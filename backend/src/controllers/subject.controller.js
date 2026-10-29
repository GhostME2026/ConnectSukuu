const prisma = require('../config/db');

/*
 * ConnectSukuu Subject Controller
 *
 * Subjects are school-specific.
 */


/*
 * List subjects belonging to the logged-in school.
 */
async function listSubjects(req, res) {
  const subjects = await prisma.subject.findMany({
    where: {
      schoolId: req.user.schoolId,
    },
    include: {
      _count: {
        select: {
          classSubjects: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });
  
  res.json(subjects);
}


/*
 * Create a new subject for the logged-in school.
 */
async function createSubject(req, res) {
  const { name, code } = req.body;
  
  if (!name) {
    return res.status(400).json({
      error: 'Subject name is required',
    });
  }
  
  const cleanName = name.trim();
  
  if (!cleanName) {
    return res.status(400).json({
      error: 'Subject name cannot be empty',
    });
  }
  
  const cleanCode =
  typeof code === 'string' && code.trim()
  ? code.trim()
  : null;
  
  try {
    const subject = await prisma.subject.create({
      data: {
        schoolId: req.user.schoolId,
        name: cleanName,
        code: cleanCode,
      },
      include: {
        _count: {
          select: {
            classSubjects: true,
          },
        },
      },
    });
    
    res.status(201).json(subject);
    
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error:
        'A subject with this name already exists for your school',
      });
    }
    
    throw err;
  }
}


/*
 * List subjects assigned to a particular class.
 */
async function listClassSubjects(req, res) {
  const { classId } = req.params;
  
  const schoolClass = await prisma.schoolClass.findFirst({
    where: {
      id: classId,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!schoolClass) {
    return res.status(404).json({
      error: 'Class not found',
    });
  }
  
  const classSubjects = await prisma.classSubject.findMany({
    where: {
      classId,
      schoolId: req.user.schoolId,
    },
    include: {
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
    orderBy: {
      subject: {
        name: 'asc',
      },
    },
  });
  
  res.json(classSubjects);
}


/*
 * Assign an existing school subject to a class.
 */
async function assignSubjectToClass(req, res) {
  const { classId } = req.params;
  const { subjectId } = req.body;
  
  if (!subjectId) {
    return res.status(400).json({
      error: 'Subject ID is required',
    });
  }
  
  /*
   * Verify that the class belongs to the logged-in user's school.
   */
  const schoolClass = await prisma.schoolClass.findFirst({
    where: {
      id: classId,
      schoolId: req.user.schoolId,
    },
    include: {
      academicYear: true,
    },
  });
  
  if (!schoolClass) {
    return res.status(404).json({
      error: 'Class not found',
    });
  }
  
  /*
   * Verify that the subject belongs to the same school.
   */
  const subject = await prisma.subject.findFirst({
    where: {
      id: subjectId,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!subject) {
    return res.status(404).json({
      error: 'Subject not found',
    });
  }
  
  /*
   * Creates the class-subject relationship.

   */
  try {
    const classSubject = await prisma.classSubject.create({
      data: {
        schoolId: req.user.schoolId,
        academicYearId: schoolClass.academicYearId,
        classId,
        subjectId,
      },
      include: {
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
        schoolClass: {
          select: {
            id: true,
            name: true,
            level: true,
            section: true,
          },
        },
      },
    });
    
    res.status(201).json(classSubject);
    
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error:
        'This subject is already assigned to this class',
      });
    }
    
    throw err;
  }
}


module.exports = {
  listSubjects,
  createSubject,
  listClassSubjects,
  assignSubjectToClass,
};
