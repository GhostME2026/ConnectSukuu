const prisma = require('../config/db');

async function listImportHistory(req, res) {
  try {
    const batches = await prisma.importBatch.findMany({
      where: {
        schoolId: req.user.schoolId,
        entityType: 'STUDENT',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        importedBy: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });
    
    return res.json({
      success: true,
      total: batches.length,
      batches,
    });
  } catch (error) {
    console.error('List import history error:', error);
    return res.status(500).json({
      error: 'Failed to load import history.',
    });
  }
}

async function getImportBatch(req, res) {
  try {
    const batch = await prisma.importBatch.findFirst({
      where: {
        id: req.params.batchId,
        schoolId: req.user.schoolId,
        entityType: 'STUDENT',
      },
      include: {
        importedBy: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        studentItems: {
          orderBy: {
            rowNumber: 'asc',
          },
          include: {
            student: true,
          },
        },
      },
    });
    
    if (!batch) {
      return res.status(404).json({
        error: 'Import batch not found.',
      });
    }
    
    return res.json({
      success: true,
      batch,
    });
  } catch (error) {
    console.error('Get import batch error:', error);
    return res.status(500).json({
      error: 'Failed to load import batch.',
    });
  }
}

module.exports = {
  listImportHistory,
  getImportBatch,
};
