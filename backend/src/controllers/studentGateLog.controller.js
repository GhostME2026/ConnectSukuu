'use strict';
const prisma = require('../config/db');
const { assertGateTransition } = require('../utils/studentGateRules');
const { sendSms } = require('../services/bmsSms.service');
async function listGateLogs(req, res) {
  try {
    const where = { schoolId: req.user.schoolId };
    if (req.user.branchId) where.student = { branchId: req.user.branchId };
    if (req.query.studentId) where.studentId = req.query.studentId;
    const logs = await prisma.studentGateLog.findMany({
      where,
      include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true, branchId:true } } },
      orderBy: { occurredAt: 'desc' },
      take: 500
    });
    return res.json({ logs });
  } catch (error) {
    console.error('security.listGateLogs:', error);
    return res.status(500).json({ error: 'Could not load security entry and exit logs.' });
  }
}

async function createGateLog(req, res) {
  try {
    const { studentId, eventType, occurredAt, notes } = req.body || {};
    const normalizedType = String(eventType || '').trim().toUpperCase();
    if (!studentId || !['ENTRY', 'EXIT'].includes(normalizedType)) {
      return res.status(400).json({ error: 'Select a student and specify ENTRY or EXIT.' });
    }
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId, ...(req.user.branchId ? { branchId: req.user.branchId } : {}) },
      select: { id: true, firstName: true, lastName: true, guardianPhone: true }
    });
    if (!student) return res.status(404).json({ error: 'Student not found in your permitted school or branch.' });
    let timestamp = new Date();
    if (occurredAt !== undefined && occurredAt !== null && occurredAt !== '') {
      timestamp = new Date(occurredAt);
      if (Number.isNaN(timestamp.getTime())) return res.status(400).json({ error: 'Enter a valid entry or exit time.' });
    }
    const log = await prisma.$transaction(async tx => {
      await assertGateTransition(tx, {
        schoolId: req.user.schoolId,
        studentId,
        eventType: normalizedType,
        occurredAt: timestamp
      });
      return tx.studentGateLog.create({
        data: { schoolId: req.user.schoolId, studentId, recordedById: req.user.id, eventType: normalizedType, occurredAt: timestamp, notes: String(notes || '').trim() || null },
        include: { student: { select: { id:true, firstName:true, lastName:true, admissionNumber:true, classLevel:true } } }
      });
    });
    // SMS is deliberately fire-and-forget after the gate transaction commits.
    // A provider failure must never roll back or delay the gate record.
    if (student.guardianPhone) {
      const action = normalizedType === 'ENTRY' ? 'checked in' : 'checked out';
      const when = timestamp.toLocaleString('en-GB', { timeZone: 'Africa/Accra' });
      void sendSms({
        schoolId: req.user.schoolId,
        eventType: 'ENTRY_EXIT',
        recipient: student.guardianPhone,
        message: `ConnectSukuu: ${student.firstName} ${student.lastName} ${action} at ${when}.`,
        idempotencyKey: `gate:${log.id}:${student.guardianPhone}`
      }).catch(error => console.error('SMS gate notification failed:', error.message || error));
    }
    return res.status(201).json({ log });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message });
    console.error('security.createGateLog:', error);
    return res.status(500).json({ error: 'Could not save the security entry or exit record.' });
  }
}

module.exports = { listGateLogs, createGateLog };
