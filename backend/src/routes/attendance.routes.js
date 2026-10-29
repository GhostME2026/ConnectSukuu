const express = require('express');

const router = express.Router();

const {
  listAttendance,
  listAttendanceStudents,
  listAttendanceLessons,
  recordAttendanceBulk,
  updateAttendance,
  deleteAttendance,
} = require('../controllers/attendance.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(requireAuth, requireActiveSubscription);

router.get('/', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','TEACHER'), listAttendance);
router.get('/students', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','TEACHER'), listAttendanceStudents);
router.get('/lessons', requireRole('HEAD_TEACHER','HEAD_OF_ACADEMICS','ADMINISTRATOR','TEACHER'), listAttendanceLessons);

// Attendance is recorded by teachers. Leadership roles have read/oversight access.
router.post('/bulk', requireRole('TEACHER'), recordAttendanceBulk);
router.patch('/:id', requireRole('TEACHER'), updateAttendance);
router.delete('/:id', requireRole('TEACHER'), deleteAttendance);

module.exports = router;
