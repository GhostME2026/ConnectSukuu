const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscription');
const { requireRole } = require('../middleware/roles');
const c = require('../controllers/nurse-portal.controller');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Incident attachments must be JPG, PNG or WEBP images.'));
    }
    cb(null, true);
  }
});
router.use(requireAuth, requireActiveSubscription, requireRole('NURSE'));
router.get('/overview', c.overview);
router.get('/health-records', c.listHealthRecords);
router.get('/health-records/:id/attachment', c.getHealthRecordAttachment);
router.post('/health-records', (req, res, next) => {
  upload.single('attachment')(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Incident attachments must be 3 MB or smaller.'
      : error.message || 'Incident attachment upload failed.';
    return res.status(400).json({ error: message });
  });
}, c.createHealthRecord);
router.patch('/health-records/:id', c.updateHealthRecord);
router.get('/announcements', c.listAnnouncements);
router.get('/notifications', c.listNotifications);
router.patch('/notifications/read-all', c.markAllNotificationsRead);
router.patch('/notifications/:id/read', c.markNotificationRead);
module.exports = router;
