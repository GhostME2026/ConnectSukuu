const prisma = require('../config/db');
const clean = value => typeof value === 'string' ? value.trim() : '';
const studentWhere = req => ({ schoolId: req.user.schoolId, ...(req.user.branchId ? { branchId: req.user.branchId } : { branchId: '__NO_BRANCH__' }) });
function scopedRecordWhere(req, extra = {}) { return { schoolId: req.user.schoolId, ...(req.user.branchId ? { student: { branchId: req.user.branchId } } : { student: { branchId: '__NO_BRANCH__' } }), ...extra }; }
async function overview(req, res) {
  try {
    const base = studentWhere(req);
    const [students, activeStudents, healthRecords, upcomingAppointments, todayRecords] = await Promise.all([
      prisma.student.count({ where: base }),
      prisma.student.count({ where: { ...base, status: 'ACTIVE' } }),
      prisma.nurseHealthRecord.count({ where: scopedRecordWhere(req) }),
      prisma.nurseAppointment.count({ where: { schoolId: req.user.schoolId, nurseId: req.user.id, scheduledAt: { gte: new Date() }, status: { not: 'CANCELLED' }, ...(req.user.branchId ? { student: { branchId: req.user.branchId } } : {}) } }),
      prisma.nurseHealthRecord.count({ where: scopedRecordWhere(req, { createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) } }) })
    ]);
    return res.json({ students, activeStudents, healthRecords, upcomingAppointments, todayRecords });
  } catch (error) { console.error('nurse.overview:', error); return res.status(500).json({ error: 'Could not load the Nurse dashboard.' }); }
}
async function listHealthRecords(req, res) {
  try {
    const where = scopedRecordWhere(req, req.query.studentId ? { studentId: String(req.query.studentId) } : {});
    const records = await prisma.nurseHealthRecord.findMany({ where, select: { id:true, schoolId:true, studentId:true, nurseId:true, recordType:true, symptoms:true, assessment:true, treatment:true, medication:true, temperatureC:true, bloodPressure:true, followUpAt:true, notes:true, attachmentName:true, attachmentMime:true, createdAt:true, updatedAt:true, student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true, branchId:true } }, nurse: { select: { id:true, firstName:true, lastName:true } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    return res.json({ records });
  } catch (error) { console.error('nurse.listHealthRecords:', error); return res.status(500).json({ error: 'Could not load health records.' }); }
}
function validatePayload(body) {
  const recordType = clean(body.recordType || 'CONSULTATION').toUpperCase();
  const assessment = clean(body.assessment);
  const symptoms = clean(body.symptoms); const treatment = clean(body.treatment); const medication = clean(body.medication); const notes = clean(body.notes); const bloodPressure = clean(body.bloodPressure);
  const temperature = body.temperatureC === '' || body.temperatureC == null ? null : Number(body.temperatureC);
  const followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
  if (!assessment) return { error: 'Assessment or clinical observation is required.' };
  if (!['CONSULTATION','FIRST_AID','ILLNESS','INJURY','FOLLOW_UP','OTHER'].includes(recordType)) return { error: 'Choose a valid health record type.' };
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 25 || temperature > 45)) return { error: 'Enter a valid temperature in °C.' };
  if (followUpAt && Number.isNaN(followUpAt.getTime())) return { error: 'Enter a valid follow-up date.' };
  return { data: { recordType, assessment: assessment.slice(0,4000), symptoms: symptoms.slice(0,4000)||null, treatment: treatment.slice(0,4000)||null, medication: medication.slice(0,2000)||null, notes: notes.slice(0,4000)||null, bloodPressure: bloodPressure.slice(0,80)||null, temperatureC: temperature, followUpAt } };
}
async function createHealthRecord(req, res) {
  try {
    const studentId = clean(req.body.studentId);
    if (!studentId) return res.status(400).json({ error: 'Choose a student.' });
    const validated = validatePayload(req.body || {}); if (validated.error) return res.status(400).json({ error: validated.error });
    const student = await prisma.student.findFirst({ where: { id: studentId, ...studentWhere(req) }, select: { id: true } });
    if (!student) return res.status(404).json({ error: 'Student not found in your school or assigned branch.' });
    const attachment = req.file ? {
      attachmentName: clean(req.file.originalname).replace(/[\\/\\\\]/g, '_').slice(0, 180) || 'incident-photo',
      attachmentMime: req.file.mimetype,
      attachmentData: req.file.buffer.toString('base64')
    } : {};
    if (req.file && !isSupportedImage(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'The uploaded file does not appear to be a valid JPG, PNG or WEBP image.' });
    }
    const record = await prisma.nurseHealthRecord.create({ data: { schoolId: req.user.schoolId, studentId, nurseId: req.user.id, ...validated.data, ...attachment }, include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true } }, nurse: { select: { id:true, firstName:true, lastName:true } } } });
    const { attachmentData: _privateAttachmentData, ...safeRecord } = record;
    return res.status(201).json({ record: safeRecord });
  } catch (error) { console.error('nurse.createHealthRecord:', error); return res.status(500).json({ error: 'Could not save the health record.' }); }
}
async function updateHealthRecord(req, res) {
  try {
    const validated = validatePayload(req.body || {}); if (validated.error) return res.status(400).json({ error: validated.error });
    const existing = await prisma.nurseHealthRecord.findFirst({ where: scopedRecordWhere(req, { id: req.params.id }) });
    if (!existing) return res.status(404).json({ error: 'Health record not found in your permitted school or branch.' });
    const record = await prisma.nurseHealthRecord.update({ where: { id: existing.id }, data: validated.data, include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true } }, nurse: { select: { id:true, firstName:true, lastName:true } } } });
    return res.json({ record });
  } catch (error) { console.error('nurse.updateHealthRecord:', error); return res.status(500).json({ error: 'Could not update the health record.' }); }
}
function isSupportedImage(buffer, mime) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mime === 'image/png') return buffer.length > 8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/webp') return buffer.length > 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP';
  return false;
}
async function getHealthRecordAttachment(req, res) {
  try {
    const row = await prisma.nurseHealthRecord.findFirst({
      where: scopedRecordWhere(req, { id: req.params.id }),
      select: { attachmentName:true, attachmentMime:true, attachmentData:true }
    });
    if (!row || !row.attachmentData || !row.attachmentMime) return res.status(404).json({ error: 'No incident attachment is available for this record.' });
    const allowed = new Set(['image/jpeg','image/png','image/webp']);
    if (!allowed.has(row.attachmentMime)) return res.status(415).json({ error: 'Unsupported attachment format.' });
    const bytes = Buffer.from(row.attachmentData, 'base64');
    if (!isSupportedImage(bytes, row.attachmentMime)) return res.status(415).json({ error: 'The stored attachment is invalid.' });
    res.set('Content-Type', row.attachmentMime);
    res.set('Content-Disposition', `inline; filename="${String(row.attachmentName || 'health-incident').replace(/["\\\\\\r\\n]/g, '_')}"`);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(bytes);
  } catch (error) { console.error('nurse.getHealthRecordAttachment:', error); return res.status(500).json({ error: 'Could not load the incident attachment.' }); }
}
async function listAnnouncements(req, res) {
  try {
    const rows = await prisma.announcement.findMany({ where: { schoolId: req.user.schoolId, OR: [{ audienceAll: true }, { audienceRoles: { has: 'NURSE' } }], AND: [{ OR: [{ branchId: null }, { branchId: req.user.branchId }] }] }, orderBy: { createdAt: 'desc' }, take: 100 });
    return res.json(rows);
  } catch (error) { console.error('nurse.listAnnouncements:', error); return res.status(500).json({ error: 'Could not load announcements.' }); }
}
async function listNotifications(req, res) {
  try { const rows = await prisma.userNotification.findMany({ where: { schoolId: req.user.schoolId, userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }); return res.json(rows); }
  catch (error) { console.error('nurse.listNotifications:', error); return res.status(500).json({ error: 'Could not load notifications.' }); }
}
async function markNotificationRead(req, res) {
  try { const result = await prisma.userNotification.updateMany({ where: { id: req.params.id, schoolId: req.user.schoolId, userId: req.user.id }, data: { readAt: new Date() } }); if (!result.count) return res.status(404).json({ error: 'Notification not found.' }); return res.json({ success: true }); }
  catch (error) { console.error('nurse.markNotificationRead:', error); return res.status(500).json({ error: 'Could not update notification.' }); }
}
async function markAllNotificationsRead(req, res) {
  try { await prisma.userNotification.updateMany({ where: { schoolId: req.user.schoolId, userId: req.user.id, readAt: null }, data: { readAt: new Date() } }); return res.json({ success: true }); }
  catch (error) { console.error('nurse.markAllNotificationsRead:', error); return res.status(500).json({ error: 'Could not update notifications.' }); }
}
module.exports = { overview, listHealthRecords, createHealthRecord, updateHealthRecord, getHealthRecordAttachment, listAnnouncements, listNotifications, markNotificationRead, markAllNotificationsRead };
