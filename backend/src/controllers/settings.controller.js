const prisma = require('../config/db');

const DEFAULTS = {
  reportClearanceEnabled: true,
  multiCampusEnabled: false,
  securityModuleEnabled: true,
  nurseModuleEnabled: true,
  defaultAttendanceMode: 'SUBJECT',
};

// GET /api/settings — any logged-in staff member can read (dashboards need
// this to decide what to show), but only OWNER can write (see below).
async function getSettings(req, res) {
  let settings = await prisma.schoolSettings.findUnique({ where: { schoolId: req.user.schoolId } });

  // A school created before this table existed, or whose row never got
  // created for some reason, just gets sensible defaults instead of a 404.
  if (!settings) {
    settings = await prisma.schoolSettings.create({ data: { schoolId: req.user.schoolId, ...DEFAULTS } });
  }

  res.json(settings);
}

// PATCH /api/settings — owner only. Body: any subset of the toggle fields.
async function updateSettings(req, res) {
  const {
    reportClearanceEnabled,
    multiCampusEnabled,
    securityModuleEnabled,
    nurseModuleEnabled,
    defaultAttendanceMode,
  } = req.body;

  if (defaultAttendanceMode && !['CLASS', 'SUBJECT'].includes(defaultAttendanceMode)) {
    return res.status(400).json({ error: 'defaultAttendanceMode must be CLASS or SUBJECT' });
  }

  const settings = await prisma.schoolSettings.upsert({
    where: { schoolId: req.user.schoolId },
    update: {
      ...(reportClearanceEnabled !== undefined && { reportClearanceEnabled }),
      ...(multiCampusEnabled !== undefined && { multiCampusEnabled }),
      ...(securityModuleEnabled !== undefined && { securityModuleEnabled }),
      ...(nurseModuleEnabled !== undefined && { nurseModuleEnabled }),
      ...(defaultAttendanceMode && { defaultAttendanceMode }),
    },
    create: { schoolId: req.user.schoolId, ...DEFAULTS },
  });

  res.json(settings);
}

module.exports = { getSettings, updateSettings, DEFAULTS };
