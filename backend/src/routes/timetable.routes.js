const express = require('express');
const router = express.Router();

const {
  listTimetable,
  listTimetableAssignments,
  createTimetableEntry,
  updateTimetableEntry,
  deleteTimetableEntry,
  previewCopyTimetable,
  copyTimetable,
} = require('../controllers/timetable.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(requireAuth, requireActiveSubscription);

router.get('/', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS','TEACHER'), listTimetable);
router.get('/assignments', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), listTimetableAssignments);
router.post('/copy/preview', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), previewCopyTimetable);
router.post('/copy', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), copyTimetable);
router.post('/', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), createTimetableEntry);
router.patch('/:id', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), updateTimetableEntry);
router.delete('/:id', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS'), deleteTimetableEntry);

module.exports=router;
