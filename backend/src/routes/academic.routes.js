const express = require('express');
const router = express.Router();

const {
  listAcademicYears,
  createAcademicYear,
  setCurrentAcademicYear,
} = require('../controllers/academic.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(requireAuth, requireActiveSubscription);

// Academic years can be viewed by relevant school staff.
router.get(
  '/',
  requireRole(
    'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER'),
  listAcademicYears
);

// Only the Owner and Head Teacher manage the academic-year structure.
router.post(
  '/',
  requireRole('HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
            createAcademicYear
);

// Only the Owner and Head Teacher can change the current academic year.
router.patch(
  '/:id/current',
  requireRole('HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
             setCurrentAcademicYear
);

module.exports = router;
