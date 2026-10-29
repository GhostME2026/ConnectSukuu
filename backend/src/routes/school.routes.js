const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getMySchool } = require('../controllers/school.controller');

// No requireActiveSubscription on purpose — a school whose trial just
// expired still needs to be able to see its own status (to know it expired).
router.get('/me', requireAuth, getMySchool);

module.exports = router;
