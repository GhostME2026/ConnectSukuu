const express = require('express');
const router = express.Router();

const {
	listTerms,
	createTerm,
	setCurrentTerm,
} = require('../controllers/term.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(
	requireAuth,
	requireActiveSubscription
);


//View terms
router.get(
	'/:academicYearId/terms',
	requireRole(
		'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER'),
	listTerms
);


//Create term
router.post(
	'/:academicYearId/terms',
	requireRole('HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
			createTerm
);


//Make term current
router.patch(
	'/:academicYearId/terms/:id/current',
	requireRole('HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
			 setCurrentTerm
);


module.exports = router;
