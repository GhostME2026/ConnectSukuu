const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');
const c = require('../controllers/learning.controller');
const router = express.Router();
const uploadDir = path.resolve(__dirname, '../../uploads/learning');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({ destination: (_r, _f, cb) => cb(null, uploadDir), filename: (_r, f, cb) => { const ext = path.extname(f.originalname || '').toLowerCase(); const base = path.basename(f.originalname || 'upload', ext).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'upload'; cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}${ext}`); } });
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.avi', '.mkv', '.ogv', '.ogg', '.mpeg', '.mpg', '.3gp', '.wmv']);
const videoUpload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return cb(null, true);
    return cb(new Error('Unsupported video file. Use MP4, M4V, WEBM, MOV, AVI, MKV, OGV, MPEG, MPG, 3GP or WMV.'));
  }
});
function handleVideoUpload(req, res, next) {
  videoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Video is larger than the 500 MB upload limit.' : err.message
    });
    next();
  });
}
router.use(requireAuth, requireActiveSubscription, requireRole('TEACHER'));
router.get('/assignments', c.listAssignments);
router.get('/homework', c.listHomework);
router.post('/homework', c.createHomework);
router.get('/homework/:id/submissions', c.listHomeworkSubmissions);
router.patch('/homework/submissions/:submissionId/grade', c.gradeHomework);
router.post('/uploads', upload.single('file'), c.upload);
router.post('/uploads/video', handleVideoUpload, c.upload);
router.get('/recorded-lessons', c.list); router.post('/recorded-lessons', c.create); router.patch('/recorded-lessons/:id', c.update); router.delete('/recorded-lessons/:id', c.remove);
router.get('/materials', c.listM); router.post('/materials', c.createM); router.patch('/materials/:id', c.updateM); router.delete('/materials/:id', c.removeM);
router.get('/live-classes', c.listL); router.post('/live-classes', c.createL); router.patch('/live-classes/:id', c.updateL); router.delete('/live-classes/:id', c.removeL);
module.exports = router;
