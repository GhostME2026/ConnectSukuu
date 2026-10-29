'use strict';
const prisma = require('../config/db');
const { assertGateTransition } = require('../utils/studentGateRules');
const { sendSms } = require('../services/bmsSms.service');

const SECURITY_READ_ROLES = ['SECURITY', 'ADMINISTRATOR', 'HEAD_TEACHER'];
function isSecurity(req) { return req.user?.role === 'SECURITY'; }
function studentScope(user) {
  return { schoolId: user.schoolId, ...(user.role === 'SECURITY' && user.branchId ? { branchId: user.branchId } : {}) };
}
function logScope(user) {
  const where = { schoolId: user.schoolId };
  // Security is restricted to its assigned branch. Head Teacher and Administrator
  // may review the school-wide report, but never create or edit records here.
  if (user.role === 'SECURITY' && user.branchId) where.student = { branchId: user.branchId };
  return where;
}
function studentWhere(req) {
  const where = studentScope(req.user);
  const q = String(req.query.q || '').trim();
  const classLevel = String(req.query.classLevel || '').trim();
  if (classLevel) where.classLevel = classLevel;
  if (q.length >= 1) where.OR = [
    { firstName: { contains: q, mode: 'insensitive' } },
    { lastName: { contains: q, mode: 'insensitive' } },
    { admissionNumber: { contains: q, mode: 'insensitive' } }
  ];
  return where;
}
async function listStudents(req, res) {
  try {
    // Keep the directory response lightweight. Guardian profiles are fetched only
    // for the student currently selected in the gate form.
    const students = await prisma.student.findMany({
      where: studentWhere(req),
      select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true, status:true, branchId:true, guardianName:true, guardianPhone:true },
      orderBy: [{firstName:'asc'},{lastName:'asc'}],
      take: 1000
    });
    return res.json({ students });
  } catch (error) { console.error('security.listStudents:', error); return res.status(500).json({error:'Could not load students in your permitted school or branch.'}); }
}
async function listStudentGuardians(req, res) {
  try {
    const student = await prisma.student.findFirst({
      where: { id:String(req.params.studentId), schoolId:req.user.schoolId, ...(req.user.role === 'SECURITY' && req.user.branchId ? {branchId:req.user.branchId} : {}) },
      select: {
        id:true, guardianName:true, guardianPhone:true,
        parentRelationships:{select:{relationship:true,isPrimary:true,canReceiveNotifications:true,parent:{select:{userId:true,user:{select:{id:true,firstName:true,lastName:true,phone:true,email:true}}}}}}
      }
    });
    if (!student) return res.status(404).json({error:'Student not found in your permitted school or branch.'});
    const guardians = (student.parentRelationships || []).map(r => ({
      id:r.parent?.user?.id || r.parent?.userId || '',
      firstName:r.parent?.user?.firstName || '',
      lastName:r.parent?.user?.lastName || '',
      phone:r.parent?.user?.phone || '',
      email:r.parent?.user?.email || '',
      relationship:r.relationship || '',
      isPrimary:Boolean(r.isPrimary),
      canReceiveNotifications:Boolean(r.canReceiveNotifications)
    })).filter(g => g.id);
    return res.json({guardians, fallback:{guardianName:student.guardianName || '', guardianPhone:student.guardianPhone || ''}});
  } catch (error) {
    console.error('security.listStudentGuardians:', error);
    return res.status(500).json({error:'Could not load registered guardians for this student.'});
  }
}
async function listGateLogs(req, res) {
  try {
    const where = logScope(req.user);
    const q = String(req.query.q || '').trim();
    const classLevel = String(req.query.classLevel || '').trim();
    if (req.query.studentId) where.studentId = String(req.query.studentId);
    if (classLevel) where.student = { ...(where.student || {}), classLevel };
    if (q) where.student = { ...(where.student || {}), OR: [
      { firstName: { contains:q, mode:'insensitive' } },
      { lastName: { contains:q, mode:'insensitive' } },
      { admissionNumber: { contains:q, mode:'insensitive' } }
    ] };
    const logs = await prisma.studentGateLog.findMany({ where, include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true, branchId:true } }, recordedBy: { select: { firstName:true,lastName:true,email:true,role:true } } }, orderBy: { occurredAt:'desc' }, take: 300 });
    return res.json({ logs, readOnly: !isSecurity(req) });
  } catch (error) { console.error('security.listGateLogs:', error); return res.status(500).json({error:'Could not load student entry and exit logs.'}); }
}
async function createGateLog(req, res) {
  if (!isSecurity(req)) return res.status(403).json({error:'Only Security staff may create gate records. This report is read-only for school leadership.'});
  try {
    const { studentId, eventType, occurredAt, notes, handlerType, handlerName, handlerPhone } = req.body || {};
    const normalizedType = String(eventType || '').trim().toUpperCase();
    const allowedHandlerTypes = ['REGISTERED_GUARDIAN','SCHOOL_BUS','OTHER_GUARDIAN','SELF','OTHER'];
    const normalizedHandlerType = String(handlerType || '').trim().toUpperCase();
    if (!studentId || !['ENTRY','EXIT'].includes(normalizedType)) return res.status(400).json({error:'Select a student and specify ENTRY or EXIT.'});
    if (!allowedHandlerTypes.includes(normalizedHandlerType)) return res.status(400).json({error:'Choose a valid transport or responsible-person category.'});
    const name = String(handlerName || '').trim();
    const phone = String(handlerPhone || '').trim();
    const guardianId = String(req.body.guardianId || '').trim();
    if (normalizedHandlerType === 'OTHER_GUARDIAN' && !name) return res.status(400).json({error:'Enter the full name of the unregistered guardian.'});
    if (normalizedHandlerType === 'SCHOOL_BUS' && !name) return res.status(400).json({error:'Enter the school bus, route or driver identifier.'});
    const student = await prisma.student.findFirst({ where: { id:studentId, schoolId:req.user.schoolId, ...(req.user.branchId ? {branchId:req.user.branchId} : {}) }, select: { id:true,firstName:true,lastName:true,admissionNumber:true,guardianName:true,guardianPhone:true,parentRelationships:{select:{canReceiveNotifications:true,parent:{select:{userId:true,user:{select:{id:true,phone:true}}}}}} } });
    if (!student) return res.status(404).json({error:'Student not found in your permitted school or branch.'});
    if (normalizedHandlerType === 'REGISTERED_GUARDIAN') {
      const linked = (student.parentRelationships || []).some(r => r.parent?.userId === guardianId || r.parent?.user?.id === guardianId);
      if (guardianId && !linked) return res.status(400).json({error:'That guardian is not linked to the selected student.'});
      if (!guardianId && !name) return res.status(400).json({error:'Choose a linked guardian or enter the responsible person’s name.'});
    }
    let timestamp = new Date();
    if (occurredAt) { timestamp = new Date(occurredAt); if (Number.isNaN(timestamp.getTime())) return res.status(400).json({error:'Enter a valid entry or exit time.'}); }
    const log = await prisma.$transaction(async tx => {
      await assertGateTransition(tx, {
        schoolId: req.user.schoolId,
        studentId,
        eventType: normalizedType,
        occurredAt: timestamp
      });
      return tx.studentGateLog.create({
        data: {
          schoolId: req.user.schoolId, studentId, recordedById: req.user.id,
          eventType: normalizedType, occurredAt: timestamp,
          notes: String(notes || '').trim() || null,
          handlerType: normalizedHandlerType, handlerName: name || null, handlerPhone: phone || null
        },
        include: {
          student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true } },
          recordedBy: { select: { firstName:true, lastName:true, email:true, role:true } }
        }
      });
    });
    const parentIds = [...new Set((student.parentRelationships||[]).map(r=>r.parent?.userId).filter(Boolean))];
    let parentNotificationsSent = 0;
    let notificationWarning = false;
    if (parentIds.length) {
      const studentName = `${student.firstName} ${student.lastName}`.trim();
      const eventLabel = normalizedType === 'ENTRY' ? 'arrived at school' : 'left school';
      const handlerLabel = ({SCHOOL_BUS:'school bus',REGISTERED_GUARDIAN:'registered parent/guardian',OTHER_GUARDIAN:'other/unregistered guardian',SELF:'student alone',OTHER:'other'})[normalizedHandlerType];
      const details = `${name ? ` Responsible person/transport: ${name}.` : ''}${phone ? ` Contact: ${phone}.` : ''}`;
      try {
        const result = await prisma.userNotification.createMany({
          data: parentIds.map(userId => ({
            schoolId:req.user.schoolId, userId, type:'STUDENT_GATE',
            title:`${studentName} ${eventLabel}`,
            content:`Security recorded that ${studentName} ${eventLabel} at ${timestamp.toLocaleString()}. Category: ${handlerLabel}.${details}${String(notes||'').trim()?` Note: ${String(notes).trim()}`:''}`,
            targetUrl:`parent-security-logs.html?studentId=${encodeURIComponent(student.id)}&record=${encodeURIComponent(log.id)}`
          }))
        });
        parentNotificationsSent = result.count;
      } catch (notificationError) {
        // A notification outage must not make a successfully saved gate record
        // look like a failed save, which can prompt a duplicate retry.
        notificationWarning = true;
        console.error('security.createGateLog: gate record saved but parent notification failed:', notificationError);
      }
    }
    const guardianPhones = new Set(
      (student.parentRelationships || [])
        .filter(r => r.canReceiveNotifications !== false)
        .map(r => String(r.parent?.user?.phone || '').trim())
        .filter(Boolean)
    );
    if (!guardianPhones.size && student.guardianPhone) guardianPhones.add(String(student.guardianPhone).trim());
    const smsWhen = timestamp.toLocaleString('en-GB', { timeZone: 'Africa/Accra' });
    const smsVerb = normalizedType === 'ENTRY' ? 'arrived at school' : 'left school';
    let smsSubmitted = 0, smsSkipped = 0, smsFailed = 0;
    for (const phoneNumber of guardianPhones) {
      try {
        const result = await sendSms({
          schoolId: req.user.schoolId, eventType: 'ENTRY_EXIT', recipient: phoneNumber,
          message: `ConnectSukuu: ${student.firstName} ${student.lastName} ${smsVerb} at ${smsWhen}.`,
          idempotencyKey: `gate:${log.id}:${phoneNumber}`
        });
        if (result.skipped) smsSkipped++; else if (result.sent) smsSubmitted++;
      } catch (smsError) {
        smsFailed++;
        console.error('security.createGateLog: SMS notification failed:', smsError.message || smsError);
      }
    }
    return res.status(201).json({
      log, parentNotificationsSent, notificationWarning, smsSubmitted, smsSkipped, smsFailed,
      message: notificationWarning
        ? 'Gate record saved, but parent notifications could not be sent.'
        : 'Security record saved.'
    });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({error:error.message});
    console.error('security.createGateLog:', error); return res.status(500).json({error:'Could not save the security entry or exit record.'});
  }
}
async function listAnnouncements(req,res) {
  try {
    const announcements=await prisma.announcement.findMany({where:{schoolId:req.user.schoolId,AND:[{OR:[{branchId:null},{branchId:req.user.branchId||null}]},{OR:[{audienceAll:true},{audienceRoles:{has:'SECURITY'}}]}]},orderBy:{createdAt:'desc'},take:100,select:{id:true,title:true,content:true,createdAt:true,audienceAll:true}});
    return res.json({announcements});
  } catch(error){console.error('security.listAnnouncements:',error);return res.status(500).json({error:'Could not load school announcements.'});}
}
function dedupeSecurityNotifications(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = row.targetUrl ? `${row.type || 'GENERAL'}|${row.targetUrl}` : `id:${row.id}`;
    const prior = byKey.get(key);
    if (!prior) { byKey.set(key, row); continue; }
    // If any copy was already read, keep the group read so duplicate rows
    // cannot repeatedly inflate the unread badge after the user opens it.
    const readAt = prior.readAt || row.readAt || null;
    const newest = new Date(row.createdAt || 0) > new Date(prior.createdAt || 0) ? row : prior;
    byKey.set(key, { ...newest, readAt });
  }
  return [...byKey.values()];
}

async function listNotifications(req,res) {
  try {
    const announcements=await prisma.announcement.findMany({where:{schoolId:req.user.schoolId,AND:[{OR:[{branchId:null},{branchId:req.user.branchId||null}]},{OR:[{audienceAll:true},{audienceRoles:{has:'SECURITY'}}]}]},select:{id:true,title:true,content:true,createdAt:true}});
    const targets=announcements.map(a=>`announcement:${a.id}`);
    if(targets.length){
      const existing=await prisma.userNotification.findMany({where:{schoolId:req.user.schoolId,userId:req.user.id,type:'ANNOUNCEMENT',targetUrl:{in:targets}},select:{targetUrl:true}});
      const present=new Set(existing.map(n=>n.targetUrl));
      const missing=announcements.filter(a=>!present.has(`announcement:${a.id}`));
      if(missing.length) await prisma.userNotification.createMany({data:missing.map(a=>({schoolId:req.user.schoolId,userId:req.user.id,type:'ANNOUNCEMENT',title:a.title,content:String(a.content||'').slice(0,4000),targetUrl:`announcement:${a.id}`})),skipDuplicates:true});
    }
    const storedNotifications=await prisma.userNotification.findMany({where:{schoolId:req.user.schoolId,userId:req.user.id},orderBy:{createdAt:'desc'},take:500});
    const notifications=dedupeSecurityNotifications(storedNotifications).slice(0,200);
    return res.json({notifications,unreadCount:notifications.filter(n=>!n.readAt).length});
  } catch(error){console.error('security.listNotifications:',error);return res.status(500).json({error:'Could not load your notifications.'});}
}
async function markNotificationRead(req,res){
  try {
    const row=await prisma.userNotification.findFirst({where:{id:req.params.id,schoolId:req.user.schoolId,userId:req.user.id},select:{id:true,type:true,targetUrl:true}});
    if(!row)return res.status(404).json({error:'Notification not found.'});
    const where=row.targetUrl
      ? {schoolId:req.user.schoolId,userId:req.user.id,type:row.type,targetUrl:row.targetUrl}
      : {id:row.id,schoolId:req.user.schoolId,userId:req.user.id};
    await prisma.userNotification.updateMany({where,data:{readAt:new Date()}});
    return res.json({message:'Notification marked as read.'});
  } catch(error){console.error('security.markNotificationRead:',error);return res.status(500).json({error:'Could not update notification.'});}
}
async function markAllNotificationsRead(req,res){
  try {await prisma.userNotification.updateMany({where:{schoolId:req.user.schoolId,userId:req.user.id,readAt:null},data:{readAt:new Date()}});return res.json({message:'Notifications marked as read.'});}
  catch(error){console.error('security.markAllNotificationsRead:',error);return res.status(500).json({error:'Could not update notifications.'});}
}
module.exports={listStudents,listStudentGuardians,listGateLogs,createGateLog,listAnnouncements,listNotifications,markNotificationRead,markAllNotificationsRead};
