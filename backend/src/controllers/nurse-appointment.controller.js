const prisma = require('../config/db');
const { createStudentNotifications } = require('../utils/studentNotifications');
const clean = value => typeof value === 'string' ? value.trim() : '';
async function createAppointment(req, res) {
  const { studentId, title, notes, scheduledAt } = req.body || {};
  if (!req.user.branchId) return res.status(403).json({ error: 'Assign your nurse account to a branch before booking student appointments.' });
  const when = new Date(scheduledAt);
  if (!studentId || !clean(title) || !scheduledAt || Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Choose a student, appointment title and valid date/time.' });
  try {
    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId: req.user.schoolId, status: 'ACTIVE', ...(req.user.branchId ? { branchId: req.user.branchId } : {}) }, select: { id: true, firstName: true, lastName: true, branchId: true } });
    if (!student) return res.status(404).json({ error: 'Active student not found in your assigned branch.' });
    const appointment = await prisma.nurseAppointment.create({ data: { schoolId: req.user.schoolId, studentId: student.id, nurseId: req.user.id, title: clean(title).slice(0, 160), notes: clean(notes).slice(0, 2000) || null, scheduledAt: when } });
    await createStudentNotifications({ schoolId: req.user.schoolId, studentIds: [student.id], sourceKey: `nurse-appointment:${appointment.id}`, type: 'NURSE_APPOINTMENT', title: 'Health appointment scheduled', content: `The school nurse scheduled “${appointment.title}” for ${when.toLocaleString()}. Open Notifications for the appointment reminder.`, targetUrl: 'student-notifications.html' });
    return res.status(201).json({ success: true, appointment });
  } catch (err) { console.error('createAppointment:', err); return res.status(500).json({ error: 'Could not schedule the student appointment.' }); }
}
async function listAppointments(req, res) {
  try { const rows = await prisma.nurseAppointment.findMany({ where: { schoolId: req.user.schoolId, ...(req.user.role === 'NURSE' ? { nurseId: req.user.id } : {}), ...(req.user.branchId ? { student: { branchId: req.user.branchId } } : {}) }, include: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true, classLevel: true } } }, orderBy: { scheduledAt: 'asc' }, take: 300 }); return res.json(rows); }
  catch (err) { console.error('listAppointments:', err); return res.status(500).json({ error: 'Could not load appointments.' }); }
}
module.exports = { createAppointment, listAppointments };
