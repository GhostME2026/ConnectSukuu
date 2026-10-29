const fs = require('fs');
const path = require('path');

const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

const prisma = require('../config/db');

const {
	normalizeRow,
	validateStudentRow,
} = require('../utils/importValidator');

const {
	importStudents,
} = require('../services/studentImportService');


/*
 * Reads CSV or Excel files and converts them into student rows.
 */
function parseImportFile(file) {
	const extension = path
	.extname(file.originalname)
	.toLowerCase();
	
	if (extension === '.csv') {
		const content = fs.readFileSync(
			file.path,
			'utf8'
		);
		
		const records = parse(content, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		});
		
		return records.map(normalizeRow);
	}
	
	if (
		extension === '.xlsx' ||
		extension === '.xls'
	) {
		const workbook = XLSX.readFile(
			file.path
		);
		
		const firstSheet =
		workbook.Sheets[
			workbook.SheetNames[0]
		];
		
		const records =
		XLSX.utils.sheet_to_json(
			firstSheet,
			{
				defval: '',
			}
		);
		
		return records.map(normalizeRow);
	}
	
	throw new Error(
		'Unsupported file type. Please upload CSV or Excel (.xlsx) files.'
	);
}


/*
 * Reads the file and validates it without creating students.
 */
async function previewStudentImport(
	req,
	res
) {
	try {
		if (!req.file) {
			return res.status(400).json({
				error:
				'Please upload a CSV or Excel file.',
			});
		}
		
		const rows =
		parseImportFile(req.file);
		
		if (!rows.length) {
			return res.status(400).json({
				error:
				'The uploaded file contains no student records.',
			});
		}
		
		const preview = [];
		const admissionNumbers =
		new Set();
		
		for (
			let index = 0;
		index < rows.length;
		index++
		) {
			const row = rows[index];
			
			const rowNumber =
			index + 2;
			
			const errors =
			validateStudentRow(row);
			
			/*
			 * Detect duplicates inside the imported files
			 */
			if (
				row.admissionNumber
			) {
				if (
					admissionNumbers.has(
						row.admissionNumber
					)
				) {
					errors.push(
						'Duplicate admission number appears in this file.'
					);
				}
				
				admissionNumbers.add(
					row.admissionNumber
				);
			}
			
			preview.push({
				rowNumber,
				data: row,
				valid:
				errors.length === 0,
				errors,
			});
		}
		
		/*
		 * Check existing admission numbers in the school
		 */
		const validAdmissionNumbers =
		preview
		.filter((item) => item.valid)
		.map(
			(item) =>
			item.data.admissionNumber
		);
		
		if (
			validAdmissionNumbers.length
		) {
			const existing =
			await prisma.student.findMany({
				where: {
					schoolId:
					req.user.schoolId,
					admissionNumber: {
						in:
						validAdmissionNumbers,
					},
				},
				select: {
					admissionNumber: true,
				},
			});
			
			const existingNumbers =
			new Set(
				existing.map(
					(student) =>
					student.admissionNumber
				)
			);
			
			for (
				const item of preview
			) {
				if (
					existingNumbers.has(
						item.data.admissionNumber
					)
				) {
					item.valid = false;
					item.errors.push(
						`Admission number "${item.data.admissionNumber}" already exists in this school.`
					);
				}
			}
		}
		
		const validRows =
		preview.filter(
			(item) => item.valid
		).length;
		
		const invalidRows =
		preview.length - validRows;
		
		return res.json({
			success: true,
			totalRows: preview.length,
			validRows,
			invalidRows,
			rows: preview,
		});
	} catch (err) {
		console.error(
			'previewStudentImport error:',
			err
		);
		
		return res.status(400).json({
			error: err.message,
		});
	} finally {
		/*
		 * Remove temporary uploaded file.
		 */
		if (
			req.file &&
			req.file.path &&
			fs.existsSync(req.file.path)
		) {
			fs.unlinkSync(
				req.file.path
			);
		}
	}
}


/*
 * POST /api/students/import
 *
 * Imports happens here.
 */
async function executeStudentImport(
	req,
	res
) {
	try {
		if (!req.file) {
			return res.status(400).json({
				error:
				'Please upload a CSV or Excel file.',
			});
		}
		
		const rows =
		parseImportFile(req.file);
		
		if (!rows.length) {
			return res.status(400).json({
				error:
				'The uploaded file contains no student records.',
			});
		}
		
		/*
		 * Always validates rows before importing.
		 */
		const validRows = [];
		
		for (
			const row of rows
		) {
			const errors =
			validateStudentRow(row);
			
			if (
				errors.length === 0
			) {
				validRows.push(row);
			}
		}
		
		if (!validRows.length) {
			return res.status(400).json({
				error:
				'No valid student records were found.',
			});
		}
		
		const result =
		await importStudents({
			schoolId:
			req.user.schoolId,
			
			importedById:
			req.user.id,
			
			importedByName:
			`${req.user.firstName || ''} ${req.user.lastName || ''}`
			.trim() ||
			req.user.email,
			
			rows: validRows,
		});
		
		return res.status(201).json({
			success: true,
			...result,
		});
	} catch (err) {
		console.error(
			'executeStudentImport error:',
			err
		);
		
		return res.status(500).json({
			error:
			'Failed to import students.',
		});
	} finally {
		if (
			req.file &&
			req.file.path &&
			fs.existsSync(req.file.path)
		) {
			fs.unlinkSync(
				req.file.path
			);
		}
	}
}


module.exports = {
	previewStudentImport,
	executeStudentImport,
};
