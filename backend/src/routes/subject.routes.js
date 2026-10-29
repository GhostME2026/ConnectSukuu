const express = require('express');
const router = express.Router();

const {
	listSubjects,
	createSubject,
	listClassSubjects,
	assignSubjectToClass,
} = require('../controllers/subject.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');


/*
 * All Subject endpoints require:
 *
 * 1. Authentication
 * 2. Active school subscription/trial
 */
router.use(
	requireAuth,
	requireActiveSubscription
);


/*
 * THOSE WHO CAN VIEW SCHOOL SUBJECT CATALOGUE
 */
router.get(
	'/',
	requireRole(
		'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER'),
	listSubjects
);


/*
 * Create a new school subject.
 */
router.post(
	'/',
	requireRole(
		'HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
	createSubject
);


/*
 * CLASS SUBJECTS
 *
 * View subjects assigned to a class.
 */
router.get(
	'/class/:classId',
	requireRole(
		'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER'),
	listClassSubjects
);


/*
 * Assign a subject to a class.
 */
router.post(
	'/class/:classId',
	requireRole(
		'HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
	assignSubjectToClass
);


module.exports = router;
