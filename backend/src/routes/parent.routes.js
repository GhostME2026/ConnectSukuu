const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

const {
	listParents,
	createParent,
	getParent,
	updateParent,
	removeParent,
	listParentStudents,
} = require('../controllers/parent.controller');

//All parent-management routes require authentication
//and an active school subscription.
router.use(requireAuth, requireActiveSubscription);

//ADMINISTRATOR can manage parent accounts.
router.get(
	'/',
	requireRole('ADMINISTRATOR'),
		   listParents
);

router.post(
	'/',
	requireRole('ADMINISTRATOR'),
			createParent
);

router.get(
	'/:id',
	requireRole('ADMINISTRATOR'),
		   getParent
);

router.patch(
	'/:id',
	requireRole('ADMINISTRATOR'),
			 updateParent
);

router.delete(
	'/:id',
	requireRole('ADMINISTRATOR'),
			  removeParent
);

//View the students/wards linked to a parent.
router.get(
	'/:id/students',
	requireRole('ADMINISTRATOR'),
		   listParentStudents
);

module.exports = router;
