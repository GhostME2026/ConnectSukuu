const express = require('express');
const router = express.Router();

const {
	listClasses,
	createClass,
} = require('../controllers/class.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

/*
 * All class routes is designed to require:
 * 1. Authentication
 * 2. An active school subscription
 */
router.use(
	requireAuth,
	requireActiveSubscription
);


/*
 * GET /api/classes
 *
 * View classes and also
 * allows the frontend to display classes
 * for one particular academic year.
 */
router.get(
	'/',
	requireRole(
		'HEAD_TEACHER', 'ADMINISTRATOR', 'HEAD_OF_ACADEMICS', 'ACCOUNTANT', 'TEACHER'),
	listClasses
);


/*
 * POST /api/classes
 *
 * We are allowing the below roles to create a class:
 *
 * HEAD_TEACHER
 * ADMINISTRATOR
 */
router.post(
	'/',
	requireRole(
		'HEAD_TEACHER', 'HEAD_OF_ACADEMICS'),
	createClass
);


module.exports = router;
