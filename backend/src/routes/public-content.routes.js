const express = require('express');
const router = express.Router();
const { getPublicContent } = require('../controllers/platform-content.controller');

// Public pages can read approved site copy, but only authenticated SUPER_ADMINs can change it.
router.get('/', getPublicContent);
module.exports = router;
