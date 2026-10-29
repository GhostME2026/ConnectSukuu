const express = require('express');

const router = express.Router();

const {
	listTeachingAssignments,
	listTeachers,
	createTeachingAssignment,
	updateTeachingAssignment,
	deleteTeachingAssignment,
} = require('../controllers/teaching-assignment.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const {
	requireActiveSubscription,
} = require('../middleware/subscription');

router.use(
	requireAuth,
	requireActiveSubscription
);


/*
 * View teaching assignments.
 *
 * TEACHER:
 *   Can only view their own assignments.
 *
 * HEAD_TEACHER / HEAD_OF_ACADEMICS:
 *   Can view all assignments.
 */
router.get(
	'/',
	requireRole(
		'HEAD_TEACHER',
		'HEAD_OF_ACADEMICS',
		'TEACHER'
	),
	listTeachingAssignments
);


/*
 * List teachers available for academic assignment.
 *
 * Administrator is intentionally excluded.
 */
router.get(
	'/teachers',
	requireRole(
		'HEAD_TEACHER',
		'HEAD_OF_ACADEMICS'
	),
	listTeachers
);


/*
 * Create a teaching assignment.
 *
 * Currently Support only:
 *   PRIMARY
 *   ASSISTANT
 *   SUBSTITUTE
 */
router.post(
	'/',
	requireRole(
		'HEAD_TEACHER',
		'HEAD_OF_ACADEMICS'
	),
	createTeachingAssignment
);


/*
 * Changes assignment type.
 */
router.patch(
	'/:id',
	requireRole(
		'HEAD_TEACHER',
		'HEAD_OF_ACADEMICS'
	),
	updateTeachingAssignment
);


/*
 * Removes a teaching assignment.
 */
router.delete(
	'/:id',
	requireRole(
		'HEAD_TEACHER',
		'HEAD_OF_ACADEMICS'
	),
	deleteTeachingAssignment
);


module.exports = router;
