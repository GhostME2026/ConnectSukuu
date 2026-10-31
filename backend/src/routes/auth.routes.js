const express = require('express');
const multer = require('multer');
const router = express.Router();

const {
  signupSchool,
  login,
  studentLogin,
  changePassword,
} = require('../controllers/auth.controller');
const { getProfile, getProfilePhoto, saveProfilePhoto } = require('../controllers/profile.controller');
const { requireAuth } = require('../middleware/auth');
const security = require('../controllers/auth-security.controller');

const extensionByMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!extensionByMime.has(file.mimetype)) {
      return cb(new Error('Profile photos must be PNG, JPG, WEBP or GIF images.'));
    }
    cb(null, true);
  }
});

router.post('/signup-school', signupSchool);
router.post('/login', login);
router.post('/student/login', studentLogin);
router.get('/profile', requireAuth, getProfile);
router.get('/profile/photo', requireAuth, getProfilePhoto);
router.post('/profile/photo', requireAuth, (req, res, next) => {
  profileUpload.single('photo')(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Profile photos must be 5 MB or smaller.'
      : error.message || 'Profile photo upload failed.';
    return res.status(400).json({ error: message });
  });
}, saveProfilePhoto);
router.post('/change-password', requireAuth, changePassword);
router.post('/verify-login-otp', security.verifyLoginOtp);
router.get('/trusted-devices', requireAuth, security.listTrustedDevices);
router.delete('/trusted-devices/:id', requireAuth, security.revokeTrustedDevice);
router.post('/password-reset/request', security.requestPasswordReset);
router.post('/password-reset/complete', security.completePasswordReset);

module.exports = router;
