const express = require('express');

const router = express.Router();

const {
	requireAuth,
} = require('../middleware/auth');

const {
	requireRole,
} = require('../middleware/roles');

const {
	requireActiveSubscription,
} = require('../middleware/subscription');

const {
	listStaff,
	inviteStaff,
	updateStaffRole,
	removeStaff,
	assignStaffBranch,
	reactivateStaff,
} = require('../controllers/staff.controller');


router.use(
	requireAuth,
	requireActiveSubscription
);


//Anyone authenticated at the school can view staff.
router.get(
	'/',
	listStaff
);


//OWNER and HEAD_TEACHER can create staff,
// but the controller determines which specific roles
// each one is allowed to create.
router.post(
	'/',
	requireRole(
		'OWNER',
		'HEAD_TEACHER'
	),
	inviteStaff
);


// OWNER and HEAD_TEACHER can change staff roles,
router.patch('/:id/branch', requireRole('OWNER'), assignStaffBranch);
router.post('/:id/reactivate', reactivateStaff);

router.patch(
	'/:id',
	requireRole(
		'OWNER',
		'HEAD_TEACHER'
	),
	updateStaffRole
);


//OWNER and HEAD_TEACHER can remove staff,
router.delete(
	'/:id',
	requireRole(
		'OWNER',
		'HEAD_TEACHER'
	),
	removeStaff
);


module.exports = router;
