const fs = require('fs');
const prisma = require('../config/db');

const teacherId = req => req.user.id;
const schoolId = req => req.user.schoolId;

function teacherAnnouncementBranch(req) {
  return req.user.branchId || null;
}

async function getMe(req, res) {
  try {
    const user = await prisma.user.findFirst({
      where: { id: teacherId(req), schoolId: schoolId(req), role: 'TEACHER' },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, schoolId: true, branchId: true, photoUrl: true },
    });
    if (!user) return res.status(404).json({ error: 'Teacher account not found.' });
    return res.json({ user });
  } catch (error) {
    console.error('teacherPortal.getMe:', error);
    return res.status(500).json({ error: 'Could not load the teacher profile.' });
  }
}

async function getAnnouncements(req, res) {
  try {
    const branchId = teacherAnnouncementBranch(req);
    const announcements = await prisma.$queryRaw`
      SELECT a."id", a."schoolId", a."branchId", a."createdById", a."title", a."content",
             a."audienceAll", a."audienceRoles", a."createdAt", a."updatedAt",
             COALESCE(n."readAt" IS NOT NULL, FALSE) AS "isRead"
      FROM "Announcement" a
      LEFT JOIN "UserNotification" n
        ON n."schoolId" = a."schoolId"
       AND n."userId" = ${teacherId(req)}
       AND n."type" = 'ANNOUNCEMENT'
       AND n."targetUrl" = ('announcement:' || a."id")
      WHERE a."schoolId" = ${schoolId(req)}
        AND (a."audienceAll" = TRUE OR 'TEACHER' = ANY(a."audienceRoles"))
        AND (a."branchId" IS NULL OR a."branchId" = ${branchId})
      ORDER BY a."createdAt" DESC
      LIMIT 100`;
    return res.json({ announcements });
  } catch (error) {
    console.error('teacherPortal.getAnnouncements:', error);
    return res.status(500).json({ error: 'Failed to load teacher announcements. Confirm the teacher communications migration is applied.' });
  }
}

async function getNotifications(req, res) {
  try {
    const branchId = teacherAnnouncementBranch(req);
    const announcements = await prisma.$queryRaw`
      SELECT a."id", a."title", a."content", a."createdAt"
      FROM "Announcement" a
      WHERE a."schoolId" = ${schoolId(req)}
        AND (a."audienceAll" = TRUE OR 'TEACHER' = ANY(a."audienceRoles"))
        AND (a."branchId" IS NULL OR a."branchId" = ${branchId})
      ORDER BY a."createdAt" DESC
      LIMIT 100`;
    for (const a of announcements) {
      const targetUrl = `announcement:${a.id}`;
      const existing = await prisma.$queryRaw`
        SELECT "id" FROM "UserNotification"
        WHERE "schoolId" = ${schoolId(req)} AND "userId" = ${teacherId(req)}
          AND "type" = 'ANNOUNCEMENT' AND "targetUrl" = ${targetUrl}
        LIMIT 1`;
      if (!existing.length) {
        await prisma.$executeRaw`
          INSERT INTO "UserNotification" ("id", "schoolId", "userId", "type", "title", "content", "targetUrl", "createdAt")
          VALUES (${require('crypto').randomUUID()}, ${schoolId(req)}, ${teacherId(req)}, 'ANNOUNCEMENT', ${a.title}, ${String(a.content || '').slice(0, 4000)}, ${targetUrl}, NOW())`;
      }
    }
    const notifications = await prisma.$queryRaw`
      SELECT "id", "schoolId", "userId", "type", "title", "content", "targetUrl", "readAt", "createdAt"
      FROM "UserNotification"
      WHERE "schoolId" = ${schoolId(req)} AND "userId" = ${teacherId(req)}
      ORDER BY "createdAt" DESC
      LIMIT 200`;
    return res.json({ notifications, unreadCount: notifications.filter(n => !n.readAt).length });
  } catch (error) {
    console.error('teacherPortal.getNotifications:', error);
    return res.status(500).json({ error: 'Failed to load teacher notifications. Confirm the teacher communications migration is applied.' });
  }
}

async function markNotificationRead(req, res) {
  try {
    const found = await prisma.$queryRaw`
      SELECT "id" FROM "UserNotification"
      WHERE "id" = ${req.params.id} AND "schoolId" = ${schoolId(req)} AND "userId" = ${teacherId(req)} LIMIT 1`;
    if (!found.length) return res.status(404).json({ error: 'Notification not found.' });
    await prisma.$executeRaw`
      UPDATE "UserNotification" SET "readAt" = COALESCE("readAt", NOW())
      WHERE "id" = ${req.params.id} AND "schoolId" = ${schoolId(req)} AND "userId" = ${teacherId(req)}`;
    return res.json({ success: true });
  } catch (error) {
    console.error('teacherPortal.markNotificationRead:', error);
    return res.status(500).json({ error: 'Could not update the notification.' });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    await prisma.$executeRaw`
      UPDATE "UserNotification" SET "readAt" = NOW()
      WHERE "schoolId" = ${schoolId(req)} AND "userId" = ${teacherId(req)} AND "readAt" IS NULL`;
    return res.json({ success: true });
  } catch (error) {
    console.error('teacherPortal.markAllNotificationsRead:', error);
    return res.status(500).json({ error: 'Could not update teacher notifications.' });
  }
}

async function uploadProfilePhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose a PNG, JPG, WEBP or GIF image first.' });
  try {
    const relativeUrl = `/uploads/profiles/${req.file.filename}`;
    const user = await prisma.user.update({
      where: { id: teacherId(req) },
      data: { photoUrl: relativeUrl },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, schoolId: true, branchId: true, photoUrl: true },
    });
    return res.json({ success: true, user });
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('teacherPortal.uploadProfilePhoto:', error);
    return res.status(500).json({ error: 'Could not save the profile photo. Confirm User.photoUrl exists in the database.' });
  }
}

module.exports = { getMe, getAnnouncements, getNotifications, markNotificationRead, markAllNotificationsRead, uploadProfilePhoto };
