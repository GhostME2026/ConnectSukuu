const prisma = require('../config/db');

function apiKeyConfigured() { return Boolean(String(process.env.BMS_AFRICA_API_KEY || '').trim()); }
function resolveSenderId(platform) { return String(platform?.senderId || process.env.BMS_AFRICA_SENDER_ID || '').trim(); }
function segmentsFor(message) {
  // Conservative GSM estimate. Unicode/multi-part details should be confirmed with provider billing.
  return Math.max(1, Math.ceil(String(message || '').length / 160));
}
async function getPlatformSettings() {
  return prisma.smsPlatformSettings.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} });
}
async function sendSms({ schoolId = null, eventType, recipient, message, idempotencyKey = null }) {
  if (!eventType || !recipient || !message) throw new Error('eventType, recipient and message are required');
  const platform = await getPlatformSettings();
  if (!platform.enabled) return { skipped: true, reason: 'PLATFORM_SMS_DISABLED' };
  let schoolSettings = null;
  if (schoolId && String(eventType).toUpperCase() !== 'TEST') {
    schoolSettings = await prisma.smsSchoolSettings.findUnique({ where: { schoolId } });
    if (!schoolSettings?.enabled) return { skipped: true, reason: 'SCHOOL_SMS_DISABLED' };
    const settingField = ({
      ENTRY_EXIT: 'entryExitEnabled',
      ANNOUNCEMENT: 'announcementsEnabled',
      REPORT_CARD: 'reportCardsEnabled',
      STAFF_ALERT: 'staffAlertsEnabled'
    })[String(eventType).toUpperCase()];
    if (settingField && !schoolSettings[settingField]) {
      return { skipped: true, reason: 'SCHOOL_SMS_EVENT_DISABLED', eventType: String(eventType).toUpperCase() };
    }
  }
  const apiKey = String(process.env.BMS_AFRICA_API_KEY || '').trim();
  const senderId = resolveSenderId(platform);
  if (!apiKey) throw new Error('BMS_AFRICA_API_KEY is missing from the backend environment');
  if (!senderId) throw new Error('Set the approved BMS sender ID in Super Admin > SMS delivery or BMS_AFRICA_SENDER_ID in the backend environment');
  if (senderId.length > 11) throw new Error('BMS sender ID must be 11 characters or fewer');
  // Global usage guard; SMS access is controlled centrally by Super Admin.
  const now = new Date();
  if (schoolId && schoolSettings && Number(schoolSettings.monthlySegmentLimit || 0) > 0) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const schoolUsage = await prisma.smsDeliveryLog.aggregate({
      where: { schoolId, createdAt: { gte: monthStart }, status: { in: ['QUEUED', 'SUBMITTED', 'DELIVERED'] } },
      _sum: { segments: true }
    });
    if (Number(schoolUsage._sum.segments || 0) + segmentsFor(message) > Number(schoolSettings.monthlySegmentLimit)) {
      throw new Error('This school has reached its monthly SMS segment limit.');
    }
  }
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dailyUsage = await prisma.smsDeliveryLog.aggregate({
    where: { createdAt: { gte: dayStart }, status: { in: ['QUEUED', 'SUBMITTED'] } },
    _sum: { segments: true }
  });
  if (Number(platform.maxDailySegments || 0) > 0 &&
      Number(dailyUsage._sum.segments || 0) + segmentsFor(message) > Number(platform.maxDailySegments)) {
    throw new Error('Global daily SMS segment limit reached. Increase the limit in Super Admin settings or try again tomorrow.');
  }
  if (idempotencyKey) {
    const existing = await prisma.smsDeliveryLog.findUnique({ where: { idempotencyKey } });
    if (existing) return { duplicate: true, logId: existing.id, status: existing.status };
  }
  const segments = segmentsFor(message);
  let log;
  try {
    log = await prisma.smsDeliveryLog.create({ data: { schoolId, eventType, recipient: String(recipient), messagePreview: String(message).slice(0,500), segments, idempotencyKey } });
  } catch (error) {
    // Concurrent retries can pass the pre-check together. The unique DB constraint
    // remains the source of truth and prevents submitting the same notification twice.
    if (idempotencyKey && error?.code === 'P2002') {
      const existing = await prisma.smsDeliveryLog.findUnique({ where: { idempotencyKey } });
      if (existing) return { duplicate: true, logId: existing.id, status: existing.status };
    }
    throw error;
  }
  try {
    const response = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: [String(recipient)], sender: senderId, message: String(message), is_schedule: false, schedule_date: '' }),
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || String(body.status || '').toLowerCase() !== 'success') {
      const providerMessage = body.message || body.error || body.errors?.[0]?.message;
      const msg = response.status === 401
        ? 'BMS API returned HTTP 401: the backend API key was rejected or API access is inactive. Verify that BMS_AFRICA_API_KEY is the active key from this BMS account, then restart the backend. A pending Sender ID normally needs approval before live sending, but does not by itself explain an authentication 401.'
        : (providerMessage || `BMS API returned HTTP ${response.status}`);
      await prisma.smsDeliveryLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: String(msg).slice(0,500), errorCode: String(body.code || response.status) } });
      throw new Error(msg);
    }
    const summary = body.summary || {};
    const updated = await prisma.smsDeliveryLog.update({ where: { id: log.id }, data: { status: 'SUBMITTED', providerCampaignId: summary._id ? String(summary._id) : null, providerCreditUsed: Number.isFinite(Number(summary.credit_used)) ? Number(summary.credit_used) : null } });
    return { sent: true, logId: updated.id, status: updated.status, campaignId: updated.providerCampaignId, creditUsed: updated.providerCreditUsed };
  } catch (error) {
    const current = await prisma.smsDeliveryLog.findUnique({ where: { id: log.id } }).catch(() => null);
    if (current && current.status === 'QUEUED') await prisma.smsDeliveryLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorMessage: String(error.message || error).slice(0,500) } }).catch(() => {});
    throw error;
  }
}

async function refreshDeliveryStatuses(limit = 30) {
  const apiKey = String(process.env.BMS_AFRICA_API_KEY || '').trim();
  if (!apiKey) throw new Error('BMS_AFRICA_API_KEY is missing from the backend environment');
  const pending = await prisma.smsDeliveryLog.findMany({
    where: { status: 'SUBMITTED', providerCampaignId: { not: null } },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(Number(limit) || 30, 50))
  });
  const campaignIds = [...new Set(pending.map(x => x.providerCampaignId).filter(Boolean))];
  let checked = 0, updated = 0;
  const normalizePhone = value => String(value || '').replace(/\D/g, '').replace(/^0/, '233');
  for (const campaignId of campaignIds) {
    const response = await fetch(`https://api.mnotify.com/api/campaign/${encodeURIComponent(campaignId)}?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || String(body.status || '').toLowerCase() !== 'success') {
      if (response.status === 401) throw new Error('BMS API returned HTTP 401 while checking delivery reports. Verify the active API key and account access.');
      continue;
    }
    const reports = Array.isArray(body.report) ? body.report : (body.report ? [body.report] : []);
    for (const report of reports) {
      const state = String(report.status || '').toUpperCase();
      const mapped = ['DELIVERED','FAILED','REJECTED','SUBMITTED'].includes(state) ? state : null;
      if (!mapped) continue;
      const recipient = normalizePhone(report.recipient);
      const candidates = pending.filter(x => x.providerCampaignId === campaignId && normalizePhone(x.recipient) === recipient);
      for (const item of candidates) {
        checked++;
        if (item.status !== mapped) {
          await prisma.smsDeliveryLog.update({
            where: { id: item.id },
            data: {
              status: mapped,
              errorMessage: ['FAILED','REJECTED'].includes(mapped) ? String(report.error || report.message || `Provider status: ${mapped}`).slice(0,500) : null
            }
          });
          updated++;
        }
      }
    }
  }
  return { checked, updated, campaigns: campaignIds.length };
}

module.exports = { sendSms, getPlatformSettings, segmentsFor, refreshDeliveryStatuses };
