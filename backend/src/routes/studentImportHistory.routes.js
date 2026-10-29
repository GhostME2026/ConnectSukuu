const express = require('express');
const router = express.Router();

const {
  listImportHistory,
  getImportBatch,
} = require('../controllers/studentImportHistory.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(
  requireAuth,
  requireActiveSubscription,
  requireRole('ADMINISTRATOR')
);

router.get('/', listImportHistory);

router.get('/:batchId', getImportBatch);

module.exports = router;
