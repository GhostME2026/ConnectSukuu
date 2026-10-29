const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { listSchools, getSchool, updateSchool, archiveSchool, restoreSchool, deleteSchool, listSupportTickets, updateSupportTicketStatus } = require('../controllers/admin.controller');
const platformContentController = require('../controllers/platform-content.controller');
const adminSmsController = require('../controllers/admin-sms.controller');

// No requireActiveSubscription here — you (the platform admin) aren't a school.
router.use(requireAuth, requireRole('SUPER_ADMIN'));
router.get('/platform-content', platformContentController.getAdminContent);
router.patch('/platform-content', platformContentController.updateAdminContent);
router.get('/sms', adminSmsController.getDashboard);
router.get('/sms/logs', adminSmsController.getLogs);
router.get('/sms/logs/export', adminSmsController.exportLogs);
router.patch('/sms/platform', adminSmsController.updatePlatform);
router.patch('/sms/schools/:schoolId', adminSmsController.updateSchool);
router.post('/sms/test', adminSmsController.testSend);

router.get('/subscription-cancellation-requests', requireRole('SUPER_ADMIN'), require('../controllers/admin.controller').listCancellationRequests);
router.patch('/subscription-cancellation-requests/:id', requireRole('SUPER_ADMIN'), require('../controllers/admin.controller').reviewCancellationRequest);
router.get('/support-tickets', listSupportTickets);
router.patch('/support-tickets/:id', updateSupportTicketStatus);
router.get('/schools', listSchools);
router.get('/schools/:id', getSchool);
router.patch('/schools/:id', updateSchool);
router.post('/schools/:id/archive', archiveSchool);
router.post('/schools/:id/restore', restoreSchool);
router.delete('/schools/:id', deleteSchool);

module.exports = router;
