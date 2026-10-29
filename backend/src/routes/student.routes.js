const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const studentPhotoDir = path.resolve(__dirname, '../../uploads/student-profiles');
fs.mkdirSync(studentPhotoDir, { recursive: true });
const studentPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, studentPhotoDir),
    filename: (_req, file, cb) => {
      const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[file.mimetype];
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)
      ? null : new Error('Use a PNG, JPG, WEBP or GIF image.'),
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)
  ),
});
function handleStudentPhotoUpload(req, res, next) {
  studentPhotoUpload.single('photo')(req, res, err => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Student profile photos must be 2 MB or smaller.' : (err.message || 'Invalid student photo.') });
  });
}

const {
	createStudent,
	listStudents,
	getStudent,
	updateStudent,
  updateStudentPhoto,
	removeStudent,
  permanentlyDeleteStudentsBulk,
	updateStudentStatus,
	listStudentEnrollments,
	createEnrollment,
	updateEnrollment,
	listStudentParents,
	addStudentParent,
	removeStudentParent,
  resetStudentPin,
} = require('../controllers/student.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

router.use(
	requireAuth,
	requireActiveSubscription
);


/*
 * STUDENT LIST / CREATE
 */

router.get(
	'/',
	requireRole(
		'HEAD_TEACHER',
		'ADMINISTRATOR',
		'HEAD_OF_ACADEMICS',
		'TEACHER',
		'NURSE'
	),
	listStudents
);

router.post(
	'/',
	requireRole(
		'ADMINISTRATOR',
	),
	createStudent
);


/*
 * INDIVIDUAL STUDENT
 */

router.get(
	'/:id',
	requireRole(
		'HEAD_TEACHER',
		'ADMINISTRATOR',
		'HEAD_OF_ACADEMICS',
		'TEACHER',
		'NURSE'
	),
	getStudent
);

router.patch(
	'/:id',
	requireRole(
		'ADMINISTRATOR',
	),
	updateStudent
);

router.post('/:id/photo', requireRole('ADMINISTRATOR'), handleStudentPhotoUpload, updateStudentPhoto);


/*
 * NB: Permanent deletion is deliberately disabled by the controller.
 */
router.delete(
  '/bulk',
  requireRole(
    'ADMINISTRATOR',
  ),
  permanentlyDeleteStudentsBulk
);

router.delete(
	'/:id',
	requireRole(
		'ADMINISTRATOR',
	),
	removeStudent
);


/*
 * STUDENT STATUS
 */

router.patch(
	'/:id/status',
	requireRole(
		'ADMINISTRATOR',
	),
	updateStudentStatus
);

/* Generate a short-lived, single-use student sign-in PIN. */
router.post(
  '/:id/reset-pin',
  requireRole('ADMINISTRATOR'),
  resetStudentPin
);


/*
 * ENROLLMENTS
 */

router.get(
	'/:id/enrollments',
	requireRole(
		'HEAD_TEACHER',
		'ADMINISTRATOR',
		'HEAD_OF_ACADEMICS',
		'TEACHER'
	),
	listStudentEnrollments
);

router.post(
	'/:id/enrollments',
	requireRole(
		'ADMINISTRATOR',
	),
	createEnrollment
);

router.patch(
	'/:id/enrollments/:enrollmentId',
	requireRole(
		'ADMINISTRATOR',
	),
	updateEnrollment
);


/*
 * PARENT / GUARDIAN RELATIONSHIPS
 */

router.get(
	'/:id/parents',
	requireRole(
		'ADMINISTRATOR',
	),
	listStudentParents
);

router.post(
	'/:id/parents',
	requireRole(
		'ADMINISTRATOR',
	),
	addStudentParent
);

router.delete(
	'/:id/parents/:parentId',
	requireRole(
		'ADMINISTRATOR',
	),
	removeStudentParent
);


module.exports = router;
