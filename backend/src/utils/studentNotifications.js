const prisma = require('../config/db');

async function createStudentNotifications({ schoolId, studentIds, sourceKey, type = 'GENERAL', title, content, targetUrl = 'student-notifications.html' }) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  if (!schoolId || !ids.length || !title) return { count: 0 };
  const body = String(content || '').slice(0, 2000);
  if (sourceKey) {
    const rows = await Promise.all(ids.map(studentId => prisma.studentNotification.upsert({
      where: { schoolId_studentId_sourceKey: { schoolId, studentId, sourceKey } },
      create: { schoolId, studentId, sourceKey, type, title, content: body, targetUrl },
      update: { type, title, content: body, targetUrl },
    })));
    return { count: rows.length };
  }
  return prisma.studentNotification.createMany({
    data: ids.map(studentId => ({ schoolId, studentId, type, title, content: body, targetUrl })),
    skipDuplicates: true,
  });
}

async function notifyClass({ schoolId, classId, academicYearId, sourceKey, type, title, content, targetUrl }) {
  if (!schoolId || !classId) return { count: 0 };
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId, classId, ...(academicYearId ? { academicYearId } : {}), status: 'ACTIVE', student: { status: 'ACTIVE' } },
    select: { studentId: true },
  });
  return createStudentNotifications({ schoolId, studentIds: enrollments.map(row => row.studentId), sourceKey, type, title, content, targetUrl });
}

module.exports = { createStudentNotifications, notifyClass };
