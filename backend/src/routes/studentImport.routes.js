const express = require('express');
const multer = require('multer');
const path = require('path');

const router = express.Router();

const {
	previewStudentImport,
	executeStudentImport,
} = require('../controllers/studentImport.controller');

const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { requireActiveSubscription } = require('../middleware/subscription');

const upload = multer({
	dest: path.join(process.cwd(), 'tmp', 'imports'),
					  
					  limits: {
						  fileSize: 10 * 1024 * 1024, // 10 MB
					  },
					  
					  fileFilter: (req, file, cb) => {
						  const extension = path.extname(file.originalname).toLowerCase();
						  
						  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
						  
						  if (!allowedExtensions.includes(extension)) {
							  return cb(
								  new Error('Only CSV and Excel files are allowed.')
							  );
						  }
						  
						  cb(null, true);
					  },
});

router.use(requireAuth, requireActiveSubscription);

// Preview uploaded student records
router.post(
	'/preview',
	requireRole('ADMINISTRATOR'),
			upload.single('file'),
			previewStudentImport
);

// Execute confirmed student import
router.post(
	'/',
	requireRole('ADMINISTRATOR'),
			upload.single('file'),
			executeStudentImport
);

module.exports = router;
