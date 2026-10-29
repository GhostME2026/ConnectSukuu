const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireStudentAuth } = require('../middleware/studentAuth');
const c = require('../controllers/studentPortal.controller');
const router = express.Router();
const profileDir = path.resolve(__dirname, '../../uploads/student-profiles');
const submissionDir = path.resolve(__dirname, '../../uploads/student-submissions');
fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(submissionDir, { recursive: true });
function makeUpload(dir, maxBytes, imageOnly = false) {
  return multer({ storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, dir), filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`) }), limits: { fileSize: maxBytes }, fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const valid = imageOnly ? /\.(png|jpe?g|webp|gif)$/i.test(ext) : /\.(pdf|png|jpe?g|webp|gif|txt|docx?|xlsx?|pptx?|zip)$/i.test(ext);
    cb(valid ? null : new Error(imageOnly ? 'Upload a PNG, JPG, WEBP or GIF image.' : 'File type is not supported.'), valid);
  } });
}
const photoUpload = makeUpload(profileDir, 5 * 1024 * 1024, true);
const submissionUpload = makeUpload(submissionDir, 20 * 1024 * 1024, false);
router.use(requireStudentAuth);
router.get('/me', c.getStudentPortal);
router.get('/subjects', c.getSubjects);
router.get('/attendance', c.getAttendance);
router.get('/academics', c.getAcademics);
router.get('/fees', c.getFees);
router.get('/announcements', c.getAnnouncements);
router.get('/notifications', c.getNotifications);
router.patch('/notifications/read-all', c.markAllNotificationsRead);
router.patch('/notifications/:id/read', c.markNotificationRead);
router.get('/learning', c.getLearning);
router.post('/assignments/:id/submissions', (req, res, next) => submissionUpload.single('file')(req, res, err => err ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message || 'Upload failed.' }) : next()), c.submitAssignment);
router.patch('/profile', c.updateProfile);
router.post('/profile/photo', (req, res, next) => photoUpload.single('photo')(req, res, err => err ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message || 'Image upload failed.' }) : next()), c.uploadProfilePhoto);
router.patch('/password', c.changePassword);
module.exports = router;
