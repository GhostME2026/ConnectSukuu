const prisma = require('../config/db');

//GET /api/academic-years/:academicYearId/terms
async function listTerms(req, res) {
  const { academicYearId } = req.params;
  
  //First verify that the academic year belongs to this school.
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
  
  const terms = await prisma.term.findMany({
    where: {
      academicYearId,
    },
    orderBy: {
      startsAt: 'asc',
    },
    include: {
      _count: {
        select: {
          enrollments: true,
        },
      },
    },
  });
  
  res.json(terms);
}


//POST /api/academic-years/:academicYearId/terms
//Owner or Head Teacher creates a term.
async function createTerm(req, res) {
  const { academicYearId } = req.params;
  const { name, startsAt, endsAt, isCurrent } = req.body;
  
  if (!name || !startsAt || !endsAt) {
    return res.status(400).json({
      error: 'Term name, start date and end date are required',
    });
  }
  
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime())
  ) {
    return res.status(400).json({
      error: 'Invalid term dates',
    });
  }
  
  if (startDate >= endDate) {
    return res.status(400).json({
      error: 'End date must be after the start date',
    });
  }
  
  //Make sure the academic year belongs to the logged-in school.
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
  
  //A term must fall completely within its academic year.
  if (
    startDate < academicYear.startsAt ||
    endDate > academicYear.endsAt
  ) {
    return res.status(400).json({
      error: 'Term dates must fall within the academic year',
    });
  }
  
  try {
    const term = await prisma.$transaction(async (tx) => {
      
      //Only one current term is allowed within an academic year.
      if (isCurrent) {
        await tx.term.updateMany({
          where: {
            academicYearId,
            isCurrent: true,
          },
          data: {
            isCurrent: false,
          },
        });
      }
      
      return tx.term.create({
        data: {
          academicYearId,
          name: name.trim(),
                            startsAt: startDate,
                            endsAt: endDate,
                            isCurrent: Boolean(isCurrent),
        },
      });
    });
    
    res.status(201).json(term);
    
  } catch (err) {
    
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'A term with this name already exists for this academic year',
      });
    }
    
    throw err;
  }
}


//PATCH /api/academic-years/:academicYearId/terms/:id/current
async function setCurrentTerm(req, res) {
  const { academicYearId, id } = req.params;
  
  //Verify the academic year belongs to this school.
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
  
  //Verify the term belongs to that academic year.
  const term = await prisma.term.findFirst({
    where: {
      id,
      academicYearId,
    },
  });
  
  if (!term) {
    return res.status(404).json({
      error: 'Term not found',
    });
  }
  
  const updated = await prisma.$transaction(async (tx) => {
    
    await tx.term.updateMany({
      where: {
        academicYearId,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });
    
    return tx.term.update({
      where: {
        id: term.id,
      },
      data: {
        isCurrent: true,
      },
    });
  });
  
  res.json(updated);
}


module.exports = {
  listTerms,
  createTerm,
  setCurrentTerm,
};
