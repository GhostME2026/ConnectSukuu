const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');
const { getSettings, updateSettings } = require('../controllers/settings.controller');

router.use(requireAuth, requireActiveSubscription);

router.get('/', getSettings);
router.patch('/', requireRole('OWNER'), updateSettings);

module.exports = router;
