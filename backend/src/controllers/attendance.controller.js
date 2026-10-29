const { Prisma } = require('@prisma/client');
const prisma = require('../config/db');

const VALID_MODES = ['CLASS', 'SUBJECT'];
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const MANAGEMENT_ROLES = ['HEAD_TEACHER', 'HEAD_OF_ACADEMICS', 'ADMINISTRATOR'];

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function makeDedupeKey({ attendanceMode, studentId, attendanceDate, timetableEntryId }) {
  const day = dateKey(attendanceDate);
  return attendanceMode === 'CLASS'
    ? `CLASS:${studentId}:${day}`
    : `SUBJECT:${studentId}:${timetableEntryId}:${day}`;
}

function isManagementRole(role) {
  return MANAGEMENT_ROLES.includes(role);
}

function isValidStatus(value) {
  return VALID_STATUSES.includes(value);
}

async function getDefaultAttendanceMode(schoolId) {
  const settings = await prisma.schoolSettings.findUnique({
    where: { schoolId },
    select: { defaultAttendanceMode: true },
  });

  return VALID_MODES.includes(settings?.defaultAttendanceMode)
    ? settings.defaultAttendanceMode
    : 'SUBJECT';
}

async function validateAcademicContext({ schoolId, academicYearId, termId, classId }) {
  const academicYear = await prisma.academicYear.findFirst({
    where: { id: academicYearId, schoolId },
  });

  if (!academicYear) return { error: 'Academic year not found', status: 404 };

  const term = await prisma.term.findFirst({
    where: {
      id: termId,
      academicYearId,
      academicYear: { schoolId },
    },
  });

  if (!term) return { error: 'Term not found for this academic year', status: 404 };

  const schoolClass = await prisma.schoolClass.findFirst({
    where: { id: classId, academicYearId, schoolId },
  });

  if (!schoolClass) {
    return { error: 'Class not found for this academic year', status: 404 };
  }

  return { academicYear, term, schoolClass };
}

async function teacherCanManageClass({ schoolId, teacherId, academicYearId, classId }) {
  const assignment = await prisma.teachingAssignment.findFirst({
    where: { schoolId, academicYearId, classId, teacherId },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function teacherCanManageTimetableEntry({ schoolId, teacherId, timetableEntryId }) {
  const entry = await prisma.timetableEntry.findFirst({
    where: {
      id: timetableEntryId,
      schoolId,
      teachingAssignment: { teacherId, schoolId },
    },
    select: { id: true },
  });
  return Boolean(entry);
}

async function authorizeAttendanceContext({
  req,
  attendanceMode,
  academicYearId,
  classId,
  timetableEntryId,
}) {
  if (isManagementRole(req.user.role)) return true;
  if (req.user.role !== 'TEACHER') return false;

  if (attendanceMode === 'CLASS') {
    return teacherCanManageClass({
      schoolId: req.user.schoolId,
      teacherId: req.user.id,
      academicYearId,
      classId,
    });
  }

  return Boolean(
    timetableEntryId &&
      (await teacherCanManageTimetableEntry({
        schoolId: req.user.schoolId,
        teacherId: req.user.id,
        timetableEntryId,
      }))
  );
}

/**
 * GET /api/attendance
 */
async function listAttendance(req, res) {
  try {
    const {
      academicYearId,
      termId,
      classId,
      studentId,
      teacherId,
      attendanceMode,
      timetableEntryId,
      date,
      attendanceDate,
      from,
      to,
    } = req.query;

    if (attendanceMode && !VALID_MODES.includes(attendanceMode)) {
      return res.status(400).json({ error: 'attendanceMode must be CLASS or SUBJECT' });
    }

    const where = { schoolId: req.user.schoolId };

    if (academicYearId) where.academicYearId = academicYearId;
    if (termId) where.termId = termId;
    if (classId) where.classId = classId;
    if (studentId) where.studentId = studentId;
    if (attendanceMode) where.attendanceMode = attendanceMode;

    if (timetableEntryId) {
      where.timetableEntryId = timetableEntryId;
    }

    const selectedDate = date || attendanceDate;
    if (selectedDate) {
      const parsedDate = parseDateOnly(selectedDate);
      if (!parsedDate) return res.status(400).json({ error: 'date/attendanceDate must use YYYY-MM-DD format' });
      where.attendanceDate = parsedDate;
    } else if (from || to) {
      where.attendanceDate = {};
      if (from) {
        const parsedFrom = parseDateOnly(from);
        if (!parsedFrom) return res.status(400).json({ error: 'from must use YYYY-MM-DD format' });
        where.attendanceDate.gte = parsedFrom;
      }
      if (to) {
        const parsedTo = parseDateOnly(to);
        if (!parsedTo) return res.status(400).json({ error: 'to must use YYYY-MM-DD format' });
        where.attendanceDate.lte = parsedTo;
      }
    }

    if (req.user.role === 'TEACHER') {
      const assignments = await prisma.teachingAssignment.findMany({
        where: {
          schoolId: req.user.schoolId,
          teacherId: req.user.id,
          ...(academicYearId ? { academicYearId } : {}),
          ...(classId ? { classId } : {}),
        },
        select: { classId: true },
        distinct: ['classId'],
      });

      const classIds = assignments.map((x) => x.classId);

      where.OR = [
        {
          attendanceMode: 'CLASS',
          classId: { in: classIds },
        },
        {
          attendanceMode: 'SUBJECT',
          timetableEntry: {
            teachingAssignment: {
              teacherId: req.user.id,
              schoolId: req.user.schoolId,
              ...(academicYearId ? { academicYearId } : {}),
            },
          },
        },
      ];
    }

    if (teacherId && req.user.role !== 'TEACHER') {
      where.timetableEntry = {
        teachingAssignment: { teacherId, schoolId: req.user.schoolId },
      };
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
        schoolClass: {
          select: { id: true, name: true, level: true, section: true },
        },
        academicYear: {
          select: { id: true, name: true, isCurrent: true },
        },
        term: {
          select: { id: true, name: true, isCurrent: true },
        },
        recordedBy: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        timetableEntry: {
          select: {
            id: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true,
            room: true,
            teachingAssignment: {
              select: {
                id: true,
                assignmentType: true,
                subject: { select: { id: true, name: true, code: true } },
                teacher: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { attendanceDate: 'desc' },
        { schoolClass: { name: 'asc' } },
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });

    return res.json(records);
  } catch (err) {
    console.error('listAttendance error:', err);
    return res.status(500).json({ error: 'Failed to load attendance' });
  }
}

/**
 * GET /api/attendance/students
 */
async function listAttendanceStudents(req, res) {
  try {
    const { academicYearId, termId, classId } = req.query;

    if (!academicYearId || !termId || !classId) {
      return res.status(400).json({
        error: 'Academic year, term and class are required',
      });
    }

    const context = await validateAcademicContext({
      schoolId: req.user.schoolId,
      academicYearId,
      termId,
      classId,
    });

    if (context.error) return res.status(context.status).json({ error: context.error });

    if (
      req.user.role === 'TEACHER' &&
      !(await teacherCanManageClass({
        schoolId: req.user.schoolId,
        teacherId: req.user.id,
        academicYearId,
        classId,
      }))
    ) {
      return res.status(403).json({ error: 'You are not assigned to this class' });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        schoolId: req.user.schoolId,
        academicYearId,
        classId,
        status: 'ACTIVE',
        OR: [{ termId: null }, { termId }],
        student: { status: 'ACTIVE' },
      },
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });

    const seen = new Set();
    const students = [];

    for (const enrollment of enrollments) {
      if (!seen.has(enrollment.student.id)) {
        seen.add(enrollment.student.id);
        students.push(enrollment.student);
      }
    }

    return res.json(students);
  } catch (err) {
    console.error('listAttendanceStudents error:', err);
    return res.status(500).json({ error: 'Failed to load attendance students' });
  }
}

/**
 * GET /api/attendance/lessons
 */
async function listAttendanceLessons(req, res) {
  try {
    const { academicYearId, termId, classId, date, teacherId } = req.query;

    if (!academicYearId || !termId || !classId) {
      return res.status(400).json({
        error: 'Academic year, term and class are required',
      });
    }

    const context = await validateAcademicContext({
      schoolId: req.user.schoolId,
      academicYearId,
      termId,
      classId,
    });

    if (context.error) return res.status(context.status).json({ error: context.error });

    const where = {
      schoolId: req.user.schoolId,
      academicYearId,
      termId,
      teachingAssignment: {
        classId,
        schoolId: req.user.schoolId,
        ...(req.user.role === 'TEACHER'
          ? { teacherId: req.user.id }
          : teacherId
            ? { teacherId }
            : {}),
      },
    };

    if (date) {
      const parsedDate = parseDateOnly(date);
      if (!parsedDate) return res.status(400).json({ error: 'date must use YYYY-MM-DD format' });

      const jsDay = parsedDate.getUTCDay();
      where.dayOfWeek = jsDay === 0 ? 7 : jsDay;
    }

    const lessons = await prisma.timetableEntry.findMany({
      where,
      include: {
        teachingAssignment: {
          select: {
            id: true,
            assignmentType: true,
            subject: { select: { id: true, name: true, code: true } },
            teacher: { select: { id: true, firstName: true, lastName: true } },
            schoolClass: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return res.json(lessons);
  } catch (err) {
    console.error('listAttendanceLessons error:', err);
    return res.status(500).json({ error: 'Failed to load attendance lessons' });
  }
}

/**
 * POST /api/attendance/bulk
 *
 * Records a whole class/lesson in one transaction.
 */
async function recordAttendanceBulk(req, res) {
  try {
    const {
      academicYearId,
      termId,
      classId,
      attendanceDate,
      attendanceMode,
      timetableEntryId,
      records,
    } = req.body;

    if (!academicYearId || !termId || !classId || !attendanceDate) {
      return res.status(400).json({
        error: 'Academic year, term, class and attendance date are required',
      });
    }

    const parsedDate = parseDateOnly(attendanceDate);
    if (!parsedDate) {
      return res.status(400).json({ error: 'attendanceDate must use YYYY-MM-DD format' });
    }

    const selectedMode =
      attendanceMode || (await getDefaultAttendanceMode(req.user.schoolId));

    if (!VALID_MODES.includes(selectedMode)) {
      return res.status(400).json({ error: 'attendanceMode must be CLASS or SUBJECT' });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        error: 'records must contain at least one student attendance record',
      });
    }

    if (records.length > 5000) {
      return res.status(400).json({
        error: 'A maximum of 5000 attendance records can be submitted at once',
      });
    }

    const context = await validateAcademicContext({
      schoolId: req.user.schoolId,
      academicYearId,
      termId,
      classId,
    });

    if (context.error) return res.status(context.status).json({ error: context.error });

    if (
      !(await authorizeAttendanceContext({
        req,
        attendanceMode: selectedMode,
        academicYearId,
        classId,
        timetableEntryId,
      }))
    ) {
      return res.status(403).json({
        error: 'You are not authorized to record attendance for this class or lesson',
      });
    }

    let timetableEntry = null;

    if (selectedMode === 'SUBJECT') {
      if (!timetableEntryId) {
        return res.status(400).json({
          error: 'timetableEntryId is required for subject-based attendance',
        });
      }

      timetableEntry = await prisma.timetableEntry.findFirst({
        where: {
          id: timetableEntryId,
          schoolId: req.user.schoolId,
          academicYearId,
          termId,
          teachingAssignment: {
            schoolId: req.user.schoolId,
            classId,
          },
        },
        include: {
          teachingAssignment: {
            select: { id: true, classId: true, teacherId: true, subjectId: true },
          },
        },
      });

      if (!timetableEntry) {
        return res.status(404).json({
          error: 'Timetable lesson not found for the selected class and term',
        });
      }

      if (
        req.user.role === 'TEACHER' &&
        timetableEntry.teachingAssignment.teacherId !== req.user.id
      ) {
        return res.status(403).json({
          error: 'You are not assigned to this timetable lesson',
        });
      }
    } else if (timetableEntryId) {
      return res.status(400).json({
        error: 'timetableEntryId must be omitted for class-based attendance',
      });
    }

    const studentIds = records.map((record) => record.studentId);

    if (studentIds.some((id) => typeof id !== 'string' || !id.trim())) {
      return res.status(400).json({
        error: 'Every attendance record must contain a studentId',
      });
    }

    if (new Set(studentIds).size !== studentIds.length) {
      return res.status(400).json({
        error: 'Duplicate studentId values are not allowed in one submission',
      });
    }

    for (const record of records) {
      if (!isValidStatus(record.status)) {
        return res.status(400).json({
          error: `Invalid attendance status for student ${record.studentId}`,
        });
      }
    }

    const enrollments = await prisma.enrollment.findMany({
      where: {
        schoolId: req.user.schoolId,
        academicYearId,
        classId,
        status: 'ACTIVE',
        OR: [{ termId: null }, { termId }],
        studentId: { in: studentIds },
        student: { status: 'ACTIVE' },
      },
      select: { studentId: true },
    });

    const enrolledIds = new Set(enrollments.map((x) => x.studentId));
    const invalidStudentIds = studentIds.filter((id) => !enrolledIds.has(id));

    if (invalidStudentIds.length) {
      return res.status(400).json({
        error: 'One or more students are not actively enrolled in the selected class',
        invalidStudentIds,
      });
    }

    const saved = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const record of records) {
        const dedupeKey = makeDedupeKey({
          attendanceMode: selectedMode,
          studentId: record.studentId,
          attendanceDate: parsedDate,
          timetableEntryId,
        });

        const result = await tx.attendanceRecord.upsert({
          where: {
            schoolId_dedupeKey: {
              schoolId: req.user.schoolId,
              dedupeKey,
            },
          },
          create: {
            schoolId: req.user.schoolId,
            academicYearId,
            termId,
            classId,
            studentId: record.studentId,
            attendanceDate: parsedDate,
            attendanceMode: selectedMode,
            status: record.status,
            timetableEntryId: selectedMode === 'SUBJECT' ? timetableEntryId : null,
            recordedById: req.user.id,
            notes:
              typeof record.notes === 'string' && record.notes.trim()
                ? record.notes.trim()
                : null,
            dedupeKey,
          },
          update: {
            status: record.status,
            notes:
              typeof record.notes === 'string' && record.notes.trim()
                ? record.notes.trim()
                : null,
            recordedById: req.user.id,
          },
        });

        results.push(result);
      }

      return results;
    });

    return res.status(201).json({
      success: true,
      count: saved.length,
      records: saved,
    });
  } catch (err) {
    console.error('recordAttendanceBulk error:', err);

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: 'Attendance already exists for one or more submitted students',
        });
      }

      if (err.code === 'P2003') {
        return res.status(400).json({
          error: 'One or more attendance references are invalid',
        });
      }
    }

    return res.status(500).json({ error: 'Failed to record attendance' });
  }
}

async function getAttendanceForAuthorization(req, id) {
  return prisma.attendanceRecord.findFirst({
    where: { id, schoolId: req.user.schoolId },
    include: {
      timetableEntry: {
        select: {
          id: true,
          teachingAssignment: { select: { teacherId: true } },
        },
      },
    },
  });
}

async function authorizeExistingAttendance(req, record) {
  if (isManagementRole(req.user.role)) return true;
  if (req.user.role !== 'TEACHER') return false;

  if (record.attendanceMode === 'SUBJECT') {
    return record.timetableEntry?.teachingAssignment?.teacherId === req.user.id;
  }

  return teacherCanManageClass({
    schoolId: req.user.schoolId,
    teacherId: req.user.id,
    academicYearId: record.academicYearId,
    classId: record.classId,
  });
}

/**
 * PATCH /api/attendance/:id
 */
async function updateAttendance(req, res) {
  try {
    const record = await getAttendanceForAuthorization(req, req.params.id);

    if (!record) return res.status(404).json({ error: 'Attendance record not found' });

    if (!(await authorizeExistingAttendance(req, record))) {
      return res.status(403).json({
        error: 'You are not authorized to modify this attendance record',
      });
    }

    const { status, notes } = req.body;

    if (status !== undefined && !isValidStatus(status)) {
      return res.status(400).json({
        error: 'status must be PRESENT, ABSENT, LATE or EXCUSED',
      });
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined
          ? {
              notes:
                typeof notes === 'string' && notes.trim() ? notes.trim() : null,
            }
          : {}),
        recordedById: req.user.id,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error('updateAttendance error:', err);
    return res.status(500).json({ error: 'Failed to update attendance' });
  }
}

/**
 * DELETE /api/attendance/:id
 */
async function deleteAttendance(req, res) {
  try {
    const record = await getAttendanceForAuthorization(req, req.params.id);

    if (!record) return res.status(404).json({ error: 'Attendance record not found' });

    if (!(await authorizeExistingAttendance(req, record))) {
      return res.status(403).json({
        error: 'You are not authorized to delete this attendance record',
      });
    }

    await prisma.attendanceRecord.delete({ where: { id: record.id } });

    return res.json({ success: true });
  } catch (err) {
    console.error('deleteAttendance error:', err);
    return res.status(500).json({ error: 'Failed to delete attendance' });
  }
}

module.exports = {
  listAttendance,
  listAttendanceStudents,
  listAttendanceLessons,
  recordAttendanceBulk,
  updateAttendance,
  deleteAttendance,
};
