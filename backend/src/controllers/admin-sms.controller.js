const prisma = require('../config/db');
const { getPlatformSettings, sendSms } = require('../services/bmsSms.service');

exports.getDashboard = async (req, res, next) => {
  try {
    const [platform, schools, recent, totals] = await Promise.all([
      getPlatformSettings(),
      prisma.school.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } }),
      prisma.smsDeliveryLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.smsDeliveryLog.groupBy({ by: ['status'], _count: { _all: true }, _sum: { segments: true, providerCreditUsed: true } })
    ]);
    const settings = await prisma.smsSchoolSettings.findMany();
    const bySchool = new Map(settings.map(s => [s.schoolId, s]));
    res.json({ platform: { enabled: platform.enabled, provider: 'BMS_AFRICA', senderId: platform.senderId || process.env.BMS_AFRICA_SENDER_ID || '', maxDailySegments: platform.maxDailySegments, apiConfigured: Boolean(String(process.env.BMS_AFRICA_API_KEY || '').trim() && String(platform.senderId || process.env.BMS_AFRICA_SENDER_ID || '').trim()) }, schools: schools.map(s => ({ ...s, sms: bySchool.get(s.id) || null })), recent, totals });
  } catch (e) { next(e); }
};
exports.updatePlatform = async (req, res, next) => {
  try {
    const data = {};
    if (typeof req.body.enabled === 'boolean') data.enabled = req.body.enabled;
    if (typeof req.body.senderId === 'string') {
      const senderId = req.body.senderId.trim();
      if (senderId.length > 11) return res.status(400).json({ error: 'Sender ID must be 11 characters or fewer.' });
      data.senderId = senderId || null;
    }
    if (Number.isInteger(req.body.maxDailySegments) && req.body.maxDailySegments >= 0) data.maxDailySegments = req.body.maxDailySegments;
    const row = await prisma.smsPlatformSettings.upsert({ where: { id: 'global' }, create: { id: 'global', ...data }, update: data });
    res.json({ ok: true, platform: { enabled: row.enabled, senderId: row.senderId, maxDailySegments: row.maxDailySegments } });
  } catch (e) { next(e); }
};
exports.updateSchool = async (req, res, next) => {
  try {
    const school = await prisma.school.findUnique({ where: { id: req.params.schoolId }, select: { id: true } });
    if (!school) return res.status(404).json({ error: 'School not found' });
    const b = req.body || {}; const data = {};
    for (const k of ['enabled','entryExitEnabled','announcementsEnabled','reportCardsEnabled','staffAlertsEnabled']) if (typeof b[k] === 'boolean') data[k] = b[k];
    if (Number.isInteger(b.monthlySegmentLimit) && b.monthlySegmentLimit >= 0) data.monthlySegmentLimit = b.monthlySegmentLimit;
    const row = await prisma.smsSchoolSettings.upsert({ where: { schoolId: school.id }, create: { schoolId: school.id, ...data }, update: data });
    res.json({ ok: true, settings: row });
  } catch (e) { next(e); }
};
exports.testSend = async (req, res, next) => {
  try {
    const recipient = String(req.body.recipient || '').trim();
    const message = String(req.body.message || 'ConnectSukuu SMS test.').trim();
    if (!/^\+?[0-9]{9,15}$/.test(recipient)) return res.status(400).json({ error: 'Enter a valid phone number, including country code if needed.' });
    if (message.length < 1 || message.length > 500) return res.status(400).json({ error: 'Message must be 1–500 characters.' });
    const result = await sendSms({ eventType: 'TEST', recipient, message, idempotencyKey: `admin-test:${Date.now()}:${recipient}` });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
};


function buildSmsLogWhere(query = {}) {
  const where = {};
  const q = String(query.q || '').trim().slice(0, 200);
  if (q) {
    where.OR = ['recipient', 'schoolId', 'eventType', 'providerCampaignId', 'errorMessage'].map(field => ({
      [field]: { contains: q, mode: 'insensitive' }
    }));
  }
  const status = String(query.status || '').trim().toUpperCase();
  if (['SUBMITTED', 'DELIVERED', 'FAILED', 'SKIPPED', 'PENDING'].includes(status)) where.status = status;
  const eventType = String(query.eventType || '').trim().toUpperCase();
  if (['TEST', 'ENTRY_EXIT', 'ANNOUNCEMENT', 'REPORT_CARD', 'STAFF_ALERT'].includes(eventType)) where.eventType = eventType;
  const createdAt = {};
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(String(query.from))) {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    if (!Number.isNaN(from.getTime())) createdAt.gte = from;
  }
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(String(query.to))) {
    const to = new Date(`${query.to}T23:59:59.999Z`);
    if (!Number.isNaN(to.getTime())) createdAt.lte = to;
  }
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  return where;
}

exports.getLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const where = buildSmsLogWhere(req.query);
    const [total, rows] = await Promise.all([
      prisma.smsDeliveryLog.count({ where }),
      prisma.smsDeliveryLog.findMany({ where, orderBy: { createdAt: sort }, skip: (page - 1) * limit, take: limit })
    ]);
    res.json({ rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), sort });
  } catch (e) { next(e); }
};

exports.exportLogs = async (req, res, next) => {
  try {
    const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const where = buildSmsLogWhere(req.query);
    const rows = await prisma.smsDeliveryLog.findMany({ where, orderBy: { createdAt: sort } });
    const columns = [
      ['Date', row => row.createdAt ? new Date(row.createdAt).toISOString() : ''],
      ['School ID', row => row.schoolId], ['Event', row => row.eventType],
      ['Recipient', row => row.recipient], ['Status', row => row.status],
      ['Segments', row => row.segments], ['Provider campaign', row => row.providerCampaignId],
      ['Error', row => row.errorMessage]
    ];
    const csvCell = value => {
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [columns.map(([label]) => csvCell(label)).join(','), ...rows.map(row => columns.map(([, get]) => csvCell(get(row))).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="connectsukuu-sms-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('\uFEFF' + csv);
  } catch (e) { next(e); }
};
