function normalizeHeader(header) {
	return String(header || '')
	.trim()
	.toLowerCase()
	.replace(/\s+/g, '')
	.replace(/[_-]/g, '');
}


/*
 * Makes different possible spreadsheet headers legitimate
 */
function normalizeRow(row) {
	const normalized = {};
	
	for (const [key, value] of Object.entries(row)) {
		normalized[normalizeHeader(key)] = value;
	}
	
	return {
		admissionNumber:
		normalized.admissionnumber ||
		normalized.admissionno ||
		normalized.admissionid ||
		'',
		
		firstName:
		normalized.firstname ||
		normalized.first ||
		'',
		
		lastName:
		normalized.lastname ||
		normalized.last ||
		'',
		
		classLevel:
		normalized.classlevel ||
		normalized.class ||
		normalized.level ||
		'',
		
		guardianName:
		normalized.guardianname ||
		normalized.parentname ||
		'',
		
		guardianPhone:
		normalized.guardianphone ||
		normalized.parentphone ||
		'',
		
		guardianEmail:
		normalized.guardianemail ||
		normalized.parentemail ||
		'',
		
		parentRelationship:
		normalized.parentrelationship ||
		normalized.relationship ||
		'',
		
		branchId:
		normalized.branchid ||
		'',
	};
}

/*
 * Detects whether a row is actually the spreadsheet header or not
 */
function isHeaderRow(row) {
	const admissionNumber =
	String(row.admissionNumber || '')
	.trim()
	.toLowerCase();
	
	const firstName =
	String(row.firstName || '')
	.trim()
	.toLowerCase();
	
	const lastName =
	String(row.lastName || '')
	.trim()
	.toLowerCase();
	
	const classLevel =
	String(row.classLevel || '')
	.trim()
	.toLowerCase();
	
	return (
		admissionNumber === 'admissionnumber' &&
		firstName === 'firstname' &&
		lastName === 'lastname' &&
		classLevel === 'classlevel'
	);
}


/*
 * Validates each student row b4 it gets to the database
 */
function validateStudentRow(row) {
	const errors = [];
	
	if (isHeaderRow(row)) {
		errors.push(
			'This row appears to be the spreadsheet header, not a student record.'
		);
		
		return errors;
	}
	
	if (!row.admissionNumber) {
		errors.push(
			'Admission number is required.'
		);
	}
	
	if (!row.firstName) {
		errors.push(
			'First name is required.'
		);
	}
	
	if (!row.lastName) {
		errors.push(
			'Last name is required.'
		);
	}
	
	if (!row.classLevel) {
		errors.push(
			'Class level is required.'
		);
	}
	
	if (
		row.parentPassword &&
		String(row.parentPassword).trim().length < 8
	) {
		errors.push(
			'Parent password must be at least 8 characters long.'
		);
	}
	
	return errors;
}

module.exports = {
	normalizeRow,
	validateStudentRow,
	isHeaderRow,
};
