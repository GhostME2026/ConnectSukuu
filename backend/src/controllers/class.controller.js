const prisma = require('../config/db');

/*
 * GET /api/classes
 * Listing all classes belonging to the current school.
 *
 * Optional query:
 * ?academicYearId=...
 *
 * This allows the F.E to request classes for a particular academic year.
 */
async function listClasses(req, res) {
  const { academicYearId } = req.query;
  
  const where = {
    schoolId: req.user.schoolId,
  };
  
  if (academicYearId) {
    where.academicYearId = academicYearId;
  }
  
  const classes = await prisma.schoolClass.findMany({
    where,
    include: {
      academicYear: {
        select: {
          id: true,
          name: true,
          isCurrent: true,
        },
      },
      _count: {
        select: {
          enrollments: true,
        },
      },
    },
    orderBy: [
      {
        academicYear: {
          startsAt: 'desc',
        },
      },
      {
        name: 'asc',
      },
    ],
  });
  
  res.json(classes);
}


/*
 * POST /api/classes
 *
 * Creating a new class.
 * Example:
 * {
 *   "academicYearId": "abc123",
 *   "name": "Class 5A",
 *   "level": "Primary",
 *   "section": "A"
 * }
 */
async function createClass(req, res) {
  const {
    academicYearId,
    name,
    level,
    section,
  } = req.body;
  
  /*
   * Required fields.
   */
  if (!academicYearId || !name) {
    return res.status(400).json({
      error: 'Academic year and class name are required',
    });
  }
  
  /* Cleans the values before saving them. */
  const cleanName = name.trim();
  const cleanLevel =
  typeof level === 'string' && level.trim()
  ? level.trim()
  : null;
  
  const cleanSection =
  typeof section === 'string' && section.trim()
  ? section.trim()
  : null;
  
  if (!cleanName) {
    return res.status(400).json({
      error: 'Class name cannot be empty',
    });
  }
  
  /*
   * This Verifies the academic year belonging
   * to the currently logged-in school.
   *
   * This is an important tenant-isolation check.
   */
  const academicYear = await prisma.academicYear.findFirst({
    where: {
      id: academicYearId,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!academicYear) {
    return res.status(404).json({
      error: 'Academic year not found',
    });
  }
  
  /*
   * Prevents duplicate class names within an academic year.
   * It also protects  with:
   *
   * @@unique([academicYearId, name])
   */
  try {
    const schoolClass = await prisma.schoolClass.create({
      data: {
        schoolId: req.user.schoolId,
        academicYearId,
        name: cleanName,
        level: cleanLevel,
        section: cleanSection,
      },
      include: {
        academicYear: {
          select: {
            id: true,
            name: true,
            isCurrent: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });
    
    res.status(201).json(schoolClass);
    
  } catch (err) {
    
    /*
     * Prisma P2002 means a unique constraint
     * was violated.
     */
    if (err.code === 'P2002') {
      return res.status(409).json({
        error:
        'A class with this name already exists for this academic year',
      });
    }
    
    throw err;
  }
}


module.exports = {
  listClasses,
  createClass,
};
