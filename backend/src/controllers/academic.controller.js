const prisma = require('../config/db');

//GET /api/academic-years
//Returns academic years belonging only to the logged-in school.
async function listAcademicYears(req, res) {
  const academicYears = await prisma.academicYear.findMany({
    where: {
      schoolId: req.user.schoolId,
    },
    include: {
      terms: {
        orderBy: {
          startsAt: 'asc',
        },
      },
      _count: {
        select: {
          classes: true,
          enrollments: true,
        },
      },
    },
    orderBy: {
      startsAt: 'desc',
    },
  });
  
  res.json(academicYears);
}

//POST /api/academic-years
//Owner or Head Teacher creates an academic year.
async function createAcademicYear(req, res) {
  const { name, startsAt, endsAt, isCurrent } = req.body;
  
  if (!name || !startsAt || !endsAt) {
    return res.status(400).json({
      error: 'Academic year name, start date and end date are required',
    });
  }
  
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return res.status(400).json({
      error: 'Invalid academic year dates',
    });
  }
  
  if (startDate >= endDate) {
    return res.status(400).json({
      error: 'End date must be after the start date',
    });
  }
  
  try {
    const academicYear = await prisma.$transaction(async (tx) => {
      //Only one academic year can be marked current for a school.
      if (isCurrent) {
        await tx.academicYear.updateMany({
          where: {
            schoolId: req.user.schoolId,
            isCurrent: true,
          },
          data: {
            isCurrent: false,
          },
        });
      }
      
      return tx.academicYear.create({
        data: {
          schoolId: req.user.schoolId,
          name: name.trim(),
                                    startsAt: startDate,
                                    endsAt: endDate,
                                    isCurrent: Boolean(isCurrent),
        },
      });
    });
    
    res.status(201).json(academicYear);
  } catch (err) {
    //Prisma unique constraint:
    //one school cannot have two academic years with the same name.
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'An academic year with this name already exists',
      });
    }
    
    throw err;
  }
}

//PATCH /api/academic-years/:id/current
//Makes an existing academic year the current one.
async function setCurrentAcademicYear(req, res) {
  const academicYear = await prisma.academicYear.findFirst({
    where: {
      id: req.params.id,
      schoolId: req.user.schoolId,
    },
  });
  
  if (!academicYear) {
    return res.status(404).json({
      error: 'Academic year not found',
    });
  }
  
  const updated = await prisma.$transaction(async (tx) => {
    await tx.academicYear.updateMany({
      where: {
        schoolId: req.user.schoolId,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });
    
    return tx.academicYear.update({
      where: {
        id: academicYear.id,
      },
      data: {
        isCurrent: true,
      },
    });
  });
  
  res.json(updated);
}

module.exports = {
  listAcademicYears,
  createAcademicYear,
  setCurrentAcademicYear,
};
