const prisma = require('../config/db');
const bcrypt = require('bcryptjs');
const { createStudentNotifications } = require('../utils/studentNotifications');

const studentId = req => req.student.id;
const schoolId = req => req.student.schoolId;
// Do not require AcademicYear.isCurrent here. Some schools have an active
// student enrollment and teaching assignments even when the current-year flag
// has not been set correctly. Prefer current-year enrollments when present;
 // otherwise use the most recent active enrollment so the portal does not
// silently hide subjects, learning content and scores.
async function activeEnrollments(req) {
  const rows = await prisma.enrollment.findMany({
    where: { schoolId: schoolId(req), studentId: studentId(req), status: 'ACTIVE' },
    include: { schoolClass: true, academicYear: true, term: true },
    orderBy: [{ academicYear: { startsAt: 'desc' } }, { enrolledAt: 'desc' }],
  });
  const current = rows.filter(row => row.academicYear && row.academicYear.isCurrent);
  if (current.length) return current;
  if (rows.length) {
    const latestYearId = rows[0].academicYearId;
    return rows.filter(row => row.academicYearId === latestYearId);
  }

  // Legacy/partially enrolled records may have classLevel populated on Student
  // but no active Enrollment row. Recover the class's current-year teaching
  // assignments by matching the student's school-managed class name.
  const classes = await prisma.schoolClass.findMany({
    where: { schoolId: schoolId(req), name: req.student.classLevel },
    include: { academicYear: true },
    orderBy: [{ academicYear: { startsAt: 'desc' } }],
  });
  const currentClasses = classes.filter(row => row.academicYear?.isCurrent);
  const fallbackClasses = currentClasses.length ? currentClasses : classes.slice(0, 1);
  return fallbackClasses.map(row => ({
    id: null, classId: row.id, academicYearId: row.academicYearId,
    schoolClass: row, academicYear: row.academicYear, term: null,
  }));
}

async function getStudentPortal(req, res) {
  try {
    const student = await prisma.student.findFirst({
      where: { id: studentId(req), schoolId: schoolId(req) },
      select: {
        id: true, admissionNumber: true, firstName: true, lastName: true, classLevel: true,
        status: true, guardianName: true, guardianPhone: true, email: true, phone: true, photoUrl: true, branchId: true,
        school: { select: { id: true, name: true, slug: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        parentRelationships: { select: { relationship: true, isPrimary: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true, email: true } } } } } },
        enrollments: { where: { status: 'ACTIVE' }, orderBy: { enrolledAt: 'desc' }, take: 3, include: { schoolClass: true, academicYear: true, term: true } },
      },
    });
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    return res.json({ success: true, student });
  } catch (err) { console.error('getStudentPortal:', err); return res.status(500).json({ error: 'Failed to load student portal.' }); }
}

async function getSubjects(req, res) {
  try {
    const enrollments = await activeEnrollments(req);
    const classIds = [...new Set(enrollments.map(e => e.classId || e.schoolClass?.id).filter(Boolean))];
    const yearIds = [...new Set(enrollments.map(e => e.academicYearId).filter(Boolean))];
    const assignments = classIds.length ? await prisma.teachingAssignment.findMany({
      where: { schoolId: schoolId(req), classId: { in: classIds }, ...(yearIds.length ? { academicYearId: { in: yearIds } } : {}) },
      include: { subject: true, schoolClass: true, academicYear: true, teacher: { select: { firstName: true, lastName: true } } },
      orderBy: [{ schoolClass: { name: 'asc' } }, { subject: { name: 'asc' } }],
    }) : [];
    const classInfo = enrollments[0]?.schoolClass || null;
    return res.json({ subjects: assignments.map(a => ({ id: a.subject.id, name: a.subject.name, code: a.subject.code, className: a.schoolClass?.name, academicYear: a.academicYear?.name, teacher: a.teacher ? `${a.teacher.firstName} ${a.teacher.lastName}`.trim() : null, teachingAssignmentId: a.id })), class: classInfo, className: classInfo?.name || req.student.classLevel || null, enrollments });
  } catch (err) { console.error('getSubjects:', err); return res.status(500).json({ error: 'Failed to load subjects.' }); }
}

async function getAttendance(req, res) {
  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { schoolId: schoolId(req), studentId: studentId(req) },
      include: { schoolClass: { select: { name: true } }, term: { select: { name: true } }, timetableEntry: { select: { startTime: true, endTime: true } } },
      orderBy: [{ attendanceDate: 'desc' }, { createdAt: 'desc' }], take: 500,
    });
    return res.json({ records });
  } catch (err) { console.error('getAttendance:', err); return res.status(500).json({ error: 'Failed to load attendance.' }); }
}

async function getAcademics(req, res) {
  try {
    const enrollments = await activeEnrollments(req);
    const classIds = [...new Set(enrollments.map(e => e.classId || e.schoolClass?.id).filter(Boolean))];

    // Keep the three academic data sources independent. A failure in report-card
    // or assessment lookup must not hide successfully graded homework.
    const settled = await Promise.allSettled([
      prisma.reportCard.findMany({
        where: { schoolId: schoolId(req), studentId: studentId(req), status: 'RELEASED' },
        include: { academicYear: true, term: true, schoolClass: true, subjects: { include: { subject: true } } },
        orderBy: { releasedAt: 'desc' },
      }),
      prisma.assessmentScore.findMany({
        where: {
          schoolId: schoolId(req), studentId: studentId(req),
          ...(classIds.length ? { assessment: { classId: { in: classIds } } } : {}),
        },
        include: { assessment: { include: { subject: true, term: true, academicYear: true, schoolClass: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.learningSubmission.findMany({
        where: { schoolId: schoolId(req), studentId: studentId(req), score: { not: null } },
        include: { learningAssignment: { include: { teachingAssignment: { include: { subject: true, schoolClass: true, academicYear: true } } } } },
        orderBy: { gradedAt: 'desc' },
      }),
    ]);
    const [reportResult, assessmentResult, homeworkResult] = settled;
    for (const [label, result] of [['report cards', reportResult], ['assessment scores', assessmentResult], ['graded homework', homeworkResult]]) {
      if (result.status === 'rejected') console.error(`getAcademics ${label}:`, result.reason);
    }
    const reportCards = reportResult.status === 'fulfilled' ? reportResult.value : [];
    const scoreRows = assessmentResult.status === 'fulfilled' ? assessmentResult.value : [];
    const homeworkRows = homeworkResult.status === 'fulfilled' ? homeworkResult.value : [];
    const ongoingAssessments = scoreRows.map(row => ({
      id: row.id, assessmentId: row.assessmentId, title: row.assessment.title,
      assessmentType: row.assessment.assessmentType, score: row.score,
      maxScore: row.assessment.maxScore,
      percentage: row.assessment.maxScore > 0 ? Math.round((row.score / row.assessment.maxScore) * 10000) / 100 : null,
      subject: row.assessment.subject?.name || 'Subject', term: row.assessment.term?.name || '',
      academicYear: row.assessment.academicYear?.name || '', status: row.assessment.status, recordedAt: row.updatedAt,
    }));
    const homeworkScores = homeworkRows.map(row => ({
      id: row.id, title: row.learningAssignment.title, score: row.score,
      maxScore: row.learningAssignment.maxScore,
      percentage: row.learningAssignment.maxScore > 0 ? Math.round((row.score / row.learningAssignment.maxScore) * 10000) / 100 : null,
      subject: row.learningAssignment.teachingAssignment?.subject?.name || 'Subject',
      className: row.learningAssignment.teachingAssignment?.schoolClass?.name || '',
      academicYear: row.learningAssignment.teachingAssignment?.academicYear?.name || '',
      feedback: row.feedback, gradedAt: row.gradedAt,
    }));
    return res.json({ reportCards, ongoingAssessments, homeworkScores });
  } catch (err) {
    console.error('getAcademics:', err);
    return res.status(500).json({ error: 'Failed to load academic progress.' });
  }
}

async function getFees(req, res) {
  try {
    const rows = await prisma.studentFee.findMany({ where: { schoolId: schoolId(req), studentId: studentId(req) }, include: { academicYear: { select: { name: true } }, term: { select: { name: true } }, payments: { select: { amount: true, allocations: { select: { amount: true } } } }, paymentAllocations: { select: { amount: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }] });
    const fees = rows.map(fee => {
      const directPayments = (fee.payments || []).reduce((sum, payment) => sum + (!(payment.allocations || []).length ? Number(payment.amount || 0) : 0), 0);
      const allocatedPayments = (fee.paymentAllocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      const paidAmount = directPayments + allocatedPayments;
      const balance = Math.max(0, Number(fee.amount || 0) - paidAmount);
      const status = balance <= 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : (fee.status || 'UNPAID');
      return { ...fee, paidAmount, balance, status };
    });
    const totals = fees.reduce((out, fee) => { out.total += Number(fee.amount || 0); out.paid += fee.paidAmount; out.balance += fee.balance; return out; }, { total: 0, paid: 0, balance: 0 });
    return res.json({ fees, totals });
  } catch (err) { console.error('getFees:', err); return res.status(500).json({ error: 'Failed to load fee records.' }); }
}

async function syncAnnouncementNotifications(req, announcements) {
  if (!announcements.length) return;
  const keys = announcements.map(a => `announcement:${a.id}`);
  const existing = await prisma.studentNotification.findMany({
    where: { schoolId: schoolId(req), studentId: studentId(req), OR: [
      { sourceKey: { in: keys } },
      { type: 'ANNOUNCEMENT', targetUrl: { in: announcements.map(a => `announcement:${a.id}`) } },
    ] },
    select: { id: true, sourceKey: true, type: true, title: true, content: true, targetUrl: true },
  });
  const bySource = new Map();
  const byTarget = new Map();
  for (const row of existing) {
    if (row.sourceKey) bySource.set(row.sourceKey, row);
    if (row.targetUrl) byTarget.set(row.targetUrl, row);
  }
  const work = [];
  for (const announcement of announcements) {
    const sourceKey = `announcement:${announcement.id}`;
    const targetUrl = sourceKey;
    const title = announcement.title;
    const content = String(announcement.content || '').slice(0, 2000);
    const row = bySource.get(sourceKey) || byTarget.get(targetUrl);
    if (row) {
      // Migrate a legacy announcement notification in place where possible.
      // This preserves its read state and original creation time.
      if (row.sourceKey !== sourceKey || row.title !== title || row.content !== content || row.type !== 'ANNOUNCEMENT') {
        work.push(() => prisma.studentNotification.update({
          where: { id: row.id },
          data: { sourceKey, type: 'ANNOUNCEMENT', title, content, targetUrl },
        }));
      }
    } else {
      work.push(() => createStudentNotifications({
        schoolId: schoolId(req), studentIds: [studentId(req)], sourceKey,
        type: 'ANNOUNCEMENT', title, content, targetUrl,
      }));
    }
  }
  // Keep database pressure bounded on the free database tier while avoiding
  // the old one-announcement-at-a-time latency on every notifications visit.
  for (let i = 0; i < work.length; i += 8) {
    await Promise.all(work.slice(i, i + 8).map(run => run()));
  }
}

async function getAnnouncements(req, res) {
  try {
    const rows = await prisma.announcement.findMany({ where: { schoolId: schoolId(req), OR: [{ audienceAll: true }, { audienceRoles: { has: 'STUDENT' } }], AND: [{ OR: [{ branchId: null }, { branchId: req.student.branchId || '__NO_BRANCH__' }] }] }, orderBy: { createdAt: 'desc' }, take: 100 });
    const notifications = await prisma.studentNotification.findMany({ where: { schoolId: schoolId(req), studentId: studentId(req), type: 'ANNOUNCEMENT' }, select: { targetUrl: true, readAt: true } });
    const state = new Map(notifications.map(n => [n.targetUrl, Boolean(n.readAt)]));
    return res.json({ announcements: rows.map(a => ({ ...a, isRead: state.get(`announcement:${a.id}`) || false })) });
  } catch (err) { console.error('getAnnouncements:', err); return res.status(500).json({ error: 'Failed to load announcements.' }); }
}

async function getNotifications(req, res) {
  try {
    // Keep announcements and notification history synchronized even if an announcement was published by an older backend build.
    const rows = await prisma.announcement.findMany({ where: { schoolId: schoolId(req), OR: [{ audienceAll: true }, { audienceRoles: { has: 'STUDENT' } }], AND: [{ OR: [{ branchId: null }, { branchId: req.student.branchId || '__NO_BRANCH__' }] }] }, orderBy: { createdAt: 'desc' }, take: 100 });
    await syncAnnouncementNotifications(req, rows);
    const notifications = await prisma.studentNotification.findMany({ where: { schoolId: schoolId(req), studentId: studentId(req) }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ notifications, unreadCount: notifications.filter(n => !n.readAt).length });
  } catch (err) { console.error('getNotifications:', err); return res.status(500).json({ error: 'Failed to load notifications.' }); }
}

async function markNotificationRead(req, res) {
  try {
    const row = await prisma.studentNotification.findFirst({ where: { id: req.params.id, schoolId: schoolId(req), studentId: studentId(req) } });
    if (!row) return res.status(404).json({ error: 'Notification not found.' });
    const updated = await prisma.studentNotification.update({ where: { id: row.id }, data: { readAt: row.readAt || new Date() } });
    return res.json({ success: true, notification: updated });
  } catch (err) { console.error('markNotificationRead:', err); return res.status(500).json({ error: 'Could not update notification.' }); }
}

async function markAllNotificationsRead(req, res) {
  try { await prisma.studentNotification.updateMany({ where: { schoolId: schoolId(req), studentId: studentId(req), readAt: null }, data: { readAt: new Date() } }); return res.json({ success: true }); }
  catch (err) { console.error('markAllNotificationsRead:', err); return res.status(500).json({ error: 'Could not update notifications.' }); }
}

async function getLearning(req, res) {
  try {
    const enrollments = await activeEnrollments(req);
    const classIds = [...new Set(enrollments.map(e => e.classId || e.schoolClass?.id).filter(Boolean))];
    const yearIds = [...new Set(enrollments.map(e => e.academicYearId).filter(Boolean))];
    if (!classIds.length) return res.json({ recordedLessons: [], materials: [], liveClasses: [], assignments: [] });
    const assignmentWhere = { schoolId: schoolId(req), classId: { in: classIds }, ...(yearIds.length ? { academicYearId: { in: yearIds } } : {}) };
    const teaching = await prisma.teachingAssignment.findMany({ where: assignmentWhere, select: { id: true } });
    const ids = teaching.map(a => a.id);
    if (!ids.length) return res.json({ recordedLessons: [], materials: [], liveClasses: [], assignments: [] });
    const include = { teachingAssignment: { include: { schoolClass: { select: { name: true } }, subject: { select: { name: true, code: true } }, academicYear: { select: { name: true } }, teacher: { select: { firstName: true, lastName: true } } } } };
    const [recordedLessons, materials, liveClasses, assignments] = await Promise.all([
      prisma.recordedLesson.findMany({ where: { schoolId: schoolId(req), teachingAssignmentId: { in: ids } }, include, orderBy: { createdAt: 'desc' } }),
      prisma.learningMaterial.findMany({ where: { schoolId: schoolId(req), teachingAssignmentId: { in: ids } }, include, orderBy: { createdAt: 'desc' } }),
      prisma.liveClass.findMany({ where: { schoolId: schoolId(req), teachingAssignmentId: { in: ids } }, include, orderBy: { scheduledAt: 'asc' } }),
      prisma.learningAssignment.findMany({ where: { schoolId: schoolId(req), teachingAssignmentId: { in: ids }, status: 'PUBLISHED' }, include: { ...include, submissions: { where: { studentId: studentId(req) } } }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }] }),
    ]);
    return res.json({ recordedLessons, materials, liveClasses, assignments });
  } catch (err) { console.error('getLearning:', err); return res.status(500).json({ error: 'Failed to load learning resources.' }); }
}

async function submitAssignment(req, res) {
  try {
    const assignment = await prisma.learningAssignment.findFirst({ where: { id: req.params.id, schoolId: schoolId(req), status: 'PUBLISHED', teachingAssignment: { schoolId: schoolId(req), classId: { in: (await activeEnrollments(req)).map(e => e.classId || e.schoolClass?.id).filter(Boolean) } } }, include: { teachingAssignment: true } });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found for your current class.' });
    if (assignment.dueAt && assignment.dueAt < new Date()) return res.status(400).json({ error: 'The submission deadline has passed.' });
    const submissionText = typeof req.body.submissionText === 'string' ? req.body.submissionText.trim().slice(0, 10000) : '';
    const attachmentUrl = req.file ? `${req.protocol}://${req.get('host')}/uploads/student-submissions/${encodeURIComponent(req.file.filename)}` : (typeof req.body.attachmentUrl === 'string' ? req.body.attachmentUrl.trim().slice(0, 2000) : null);
    if (!submissionText && !attachmentUrl) return res.status(400).json({ error: 'Write your response or attach a file before submitting.' });
    const saved = await prisma.learningSubmission.upsert({
      where: { learningAssignmentId_studentId: { learningAssignmentId: assignment.id, studentId: studentId(req) } },
      create: { schoolId: schoolId(req), learningAssignmentId: assignment.id, studentId: studentId(req), submissionText: submissionText || null, attachmentUrl },
      update: { submissionText: submissionText || null, attachmentUrl, submittedAt: new Date(), score: null, feedback: null, gradedAt: null, gradedById: null },
    });
    await prisma.userNotification.create({ data: { schoolId: schoolId(req), userId: assignment.teacherId, type: 'LEARNING_SUBMISSION', title: 'New student submission', content: `${req.student.firstName} ${req.student.lastName} submitted “${assignment.title}”.`, targetUrl: 'teacher-learning.html' } }).catch(() => {});
    return res.status(201).json({ success: true, submission: saved });
  } catch (err) { console.error('submitAssignment:', err); return res.status(500).json({ error: 'Failed to submit assignment.' }); }
}

async function updateProfile(req, res) {
  try {
    const email = req.body.email == null ? null : String(req.body.email).trim().toLowerCase();
    if (req.body.phone !== undefined && req.body.phone !== null && String(req.body.phone).trim() !== '') return res.status(403).json({ error: 'Your phone number is managed by authorized school staff.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (email) {
      const duplicate = await prisma.student.findFirst({ where: { schoolId: schoolId(req), email, id: { not: studentId(req) } }, select: { id: true } });
      if (duplicate) return res.status(409).json({ error: 'That email address is already linked to another student in this school.' });
    }
    const student = await prisma.student.update({ where: { id: studentId(req) }, data: { email: email || null }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, photoUrl: true } });
    return res.json({ success: true, student });
  } catch (err) { console.error('updateProfile:', err); return res.status(500).json({ error: 'Could not update profile details.' }); }
}

async function uploadProfilePhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose an image file first.' });
  try {
    const photoUrl = `${req.protocol}://${req.get('host')}/uploads/student-profiles/${encodeURIComponent(req.file.filename)}`;
    const student = await prisma.student.update({ where: { id: studentId(req) }, data: { photoUrl }, select: { id: true, photoUrl: true } });
    return res.json({ success: true, student });
  } catch (err) { console.error('uploadProfilePhoto:', err); return res.status(500).json({ error: 'Could not save profile photo.' }); }
}

async function changePassword(req, res) {
  try {
    const currentPin = String(req.body.currentPin || '');
    const newPin = String(req.body.newPin || '');
    if (!currentPin || newPin.length < 6 || newPin.length > 100) return res.status(400).json({ error: 'Enter your current PIN and a new password of at least 6 characters.' });
    const access = await prisma.studentAccess.findUnique({ where: { studentId: studentId(req) } });
    if (!access || !access.enabled) return res.status(403).json({ error: 'Student account access is disabled.' });
    let valid = await bcrypt.compare(currentPin, access.pinHash);
    if (!valid && access.temporaryPinHash && access.temporaryPinExpiresAt > new Date()) valid = await bcrypt.compare(currentPin, access.temporaryPinHash);
    if (!valid) return res.status(400).json({ error: 'Your current PIN/password is incorrect.' });
    const pinHash = await bcrypt.hash(newPin, 10);
    await prisma.studentAccess.update({ where: { studentId: studentId(req) }, data: { pinHash, temporaryPinHash: null, temporaryPinExpiresAt: null } });
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) { console.error('changePassword:', err); return res.status(500).json({ error: 'Could not update password.' }); }
}

module.exports = { getStudentPortal, getSubjects, getAttendance, getAcademics, getFees, getAnnouncements, getNotifications, markNotificationRead, markAllNotificationsRead, getLearning, submitAssignment, updateProfile, uploadProfilePhoto, changePassword };
