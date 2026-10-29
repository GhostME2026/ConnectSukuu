const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const c = require('../controllers/teacherPortal.controller');
const router = express.Router();
const uploadDir = path.resolve(__dirname, '../../uploads/profiles');
fs.mkdirSync(uploadDir, { recursive: true });
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const validExt = /\.(png|jpe?g|webp|gif)$/i.test(path.extname(file.originalname || ''));
    const validMime = /^image\/(png|jpeg|webp|gif)$/i.test(file.mimetype || '');
    cb(validExt && validMime ? null : new Error('Upload a PNG, JPG, WEBP or GIF image.'), validExt && validMime);
  },
});
router.use(requireAuth, requireRole('TEACHER'));
router.get('/me', c.getMe);
router.get('/announcements', c.getAnnouncements);
router.get('/notifications', c.getNotifications);
router.patch('/notifications/read-all', c.markAllNotificationsRead);
router.patch('/notifications/:id/read', c.markNotificationRead);
router.post('/profile/photo', (req, res, next) => photoUpload.single('photo')(req, res, err => {
  if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message || 'Image upload failed.' });
  next();
}), c.uploadProfilePhoto);
module.exports = router;
