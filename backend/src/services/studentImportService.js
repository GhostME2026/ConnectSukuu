const prisma = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/*
 * Generates a temporary password for a newly created parent account
 * when no default parent password was supplied during import.
 */
function generateTempPassword() {
	return crypto.randomBytes(6).toString('base64url');
}

/*
 * Generates a temporary PIN for a student portal account.
 *
 * The PIN is returned to the administrator once during
 * the import process, while only its bcrypt hash is stored.
 */
function generateStudentPin() {
	return String(
		Math.floor(100000 + Math.random() * 900000)
	);
}


/*
 * Normalizes Ghanaian phone numbers so that:
 *
 * 0244000011 | 233244000011|
 * 
 * +233244000011
 * will be treated as the same number.
 */
function normalizePhone(phone) {
	const value = String(phone || '').trim();
	
	if (!value) {
		return '';
	}
	
	if (value.startsWith('+233')) {
		return '0' + value.slice(4);
	}
	
	if (value.startsWith('233')) {
		return '0' + value.slice(3);
	}
	
	return value;
}


/*
 * Splits a guardian's full name into first and last names
 * for the Parent User record.
 *
 * The original guardianName remains unchanged on the Student.
 */
function splitGuardianName(name) {
	const parts = String(name || '')
	.trim()
	.split(/\s+/)
	.filter(Boolean);
	
	if (parts.length === 0) {
		return {
			firstName: 'Parent',
			lastName: 'User',
		};
	}
	
	if (parts.length === 1) {
		return {
			firstName: parts[0],
			lastName: 'Parent',
		};
	}
	
	return {
		firstName: parts[0],
		lastName: parts.slice(1).join(' '),
	};
}


/**
 * Importing Bulk student service.
 *
 * Each row is processed independently.
 * So a failed row does not prevent valid rows from being imported.
 */
async function importStudents({
	schoolId,
	importedById,
	importedByName,
	rows,
}) {
	if (!schoolId) {
		throw new Error('School ID is required.');
	}
	
	if (!Array.isArray(rows) || rows.length === 0) {
		throw new Error('No student records were supplied.');
	}
	
	const result = {
		totalRows: rows.length,
		successCount: 0,
		failedCount: 0,
		errors: [],
		importedStudents: [],
	};
	
	/*
	 * Create the audit batch before processing rows.
	 */
	const batch = await prisma.importBatch.create({
		data: {
			schoolId,
			importedById: importedById || null,
			importedByName: importedByName || 'Unknown',
			entityType: 'STUDENT',
			status: 'PROCESSING',
			totalRows: rows.length,
		},
	});
	
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index];
		
		/*
		 * CSV/Excel row 1 is normally the header.
		 * Therefore actual data starts at row 2.
		 */
		const rowNumber = index + 2;
		
		let admissionNumber = null;
		
		try {
			admissionNumber = String(
				row.admissionNumber || ''
			).trim();
			
			const firstName = String(
				row.firstName || ''
			).trim();
			
			const lastName = String(
				row.lastName || ''
			).trim();
			
			const classLevel = String(
				row.classLevel || ''
			).trim();
			
			const guardianName = String(
				row.guardianName || ''
			).trim();
			
			const guardianPhone = normalizePhone(
				row.guardianPhone
			);
			
			const guardianEmail = String(
				row.guardianEmail || ''
			).trim().toLowerCase();
			
			const parentRelationship = String(
				row.parentRelationship || ''
			).trim();
			
			const branchId = String(
				row.branchId || ''
			).trim();
			
			/*
			 * Optional password supplied by the administrator
			 * through the import file.
			 *
			 * If it is not supplied, a temporary password
			 * will be generated automatically.
			 */
			const parentPassword = String(
				row.parentPassword || ''
			).trim();
			
			/*
			 * Required fields.
			 */
			if (!admissionNumber) {
				throw new Error(
					'Admission number is required.'
				);
			}
			
			if (!firstName) {
				throw new Error(
					'First name is required.'
				);
			}
			
			if (!lastName) {
				throw new Error(
					'Last name is required.'
				);
			}
			
			if (!classLevel) {
				throw new Error(
					'Class level is required.'
				);
			}
			
			/*
			 * Check for duplicate admission number.
			 */
			const existingStudent =
			await prisma.student.findFirst({
				where: {
					schoolId,
					admissionNumber,
				},
			});
			
			if (existingStudent) {
				throw new Error(
					`Admission number "${admissionNumber}" already exists.`
				);
			}
			
			/*
			 * Validate branch if supplied.
			 */
			if (branchId) {
				const branch =
				await prisma.branch.findFirst({
					where: {
						id: branchId,
						schoolId,
					},
				});
				
				if (!branch) {
					throw new Error(
						`Branch "${branchId}" was not found in this school.`
					);
				}
			}
			
			/*
			 * A parent can only be created when a guardian
			 * phone number has been supplied.
			 *
			 * Phone is the primary matching/contact field.
			 */
			let parentProfile = null;
			let generatedParentPassword = null;
			let parentWasCreated = false;
			let generatedStudentPin = null;
			
			/*
			 * Everything belonging to this student row is
			 * handled inside one transaction.
			 *
			 * If parent creation or linking fails, the student
			 * creation is rolled back as well.
			 */
			const transactionResult =
			await prisma.$transaction(async (tx) => {
				
				/* Create the student. */
				const student =
				await tx.student.create({
					data: {
						schoolId,
						branchId:
						branchId || null,
						admissionNumber,
						firstName,
						lastName,
						classLevel,
						guardianName:
						guardianName || null,
						guardianPhone:
						guardianPhone || null,
					},
				});
				
				/* Creating a secure student portal with PIN. */
				const studentPin = generateStudentPin();
				
				generatedStudentPin = studentPin;
				
				const pinHash = await bcrypt.hash(
					studentPin,
					12
				);
				
				await tx.studentAccess.create({
					data: {
						studentId: student.id,
						pinHash,
						enabled: true,
					},
				});
				
				/*
				 * Create or link the parent account when
				 * guardian phone information has been supplied.
				 */
				if (guardianPhone) {
					/*
					 * 1. Search for an existing parent account */
					const existingParentUser =
					await tx.user.findFirst({
						where: {
							schoolId,
							role: 'PARENT',
							phone: guardianPhone,
						},
						include: {
							parentProfile: true,
						},
					});
					
					if (
						existingParentUser &&
						existingParentUser.parentProfile
					) {
						/*
						 * Reuse the existing parent account.
						 *
						 * This is what allows one parent
						 * to have multiple children.
						 */
						parentProfile =
						existingParentUser.parentProfile;
					} else {
						/*
						 * A parent does not yet exist.
						 * Create a new parent account.
						 */
						const guardianNames =
						splitGuardianName(
							guardianName
						);
						
						/*
						 * Use the administrator-supplied
						 * password when available.
						 *
						 * Otherwise generate a temporary
						 * password as a fallback.
						 */
						const passwordToUse =
						parentPassword ||
						generateTempPassword();
						
						if (!parentPassword) {
							generatedParentPassword =
							passwordToUse;
						}
						
						const passwordHash =
						await bcrypt.hash(
							passwordToUse,
						12
						);
						
						const parentUser =
						await tx.user.create({
							data: {
								email:
								guardianEmail ||
								null,
								phone:
								guardianPhone,
								passwordHash,
								firstName:
								guardianNames.firstName,
								lastName:
								guardianNames.lastName,
								role: 'PARENT',
								schoolId,
								mustChangePassword:
								true,
							},
						});
						
						parentProfile =
						await tx.parentProfile.create({
							data: {
								userId:
								parentUser.id,
								schoolId,
							},
						});
						
						parentWasCreated = true;
					}
					
					/*
					 * Check whether this exact parent/student
					 * relationship already exists.
					 */
					const existingRelationship =
					await tx.parentStudent.findUnique({
						where: {
							parentId_studentId: {
								parentId:
								parentProfile.id,
								studentId:
								student.id,
							},
						},
					});
					
					if (!existingRelationship) {
						/*
						 * New parent relationships are primary
						 * by default when this is the first
						 * parent attached to the student.
						 */
						const existingPrimary =
						await tx.parentStudent.findFirst({
							where: {
								studentId:
								student.id,
								isPrimary: true,
							},
						});
						
						await tx.parentStudent.create({
							data: {
								parentId:
								parentProfile.id,
								studentId:
								student.id,
								relationship:
								parentRelationship ||
								'Guardian',
								isPrimary:
								!existingPrimary,
								canReceiveNotifications:
								true,
							},
						});
					}
				}
				
				return {
					student,
					parentProfile,
				};
			});
			
			const student =
			transactionResult.student;
			
			/*
			 * Record successful import item.
			 */
			await prisma.importBatchStudent.create({
				data: {
					importBatchId: batch.id,
					studentId: student.id,
					rowNumber,
					admissionNumber,
					status: 'IMPORTED',
				},
			});
			
			result.successCount++;
			
			const importedStudent = {
				id: student.id,
				admissionNumber,
				firstName,
				lastName,
				rowNumber,
				
				studentAccess: {
					loginId: admissionNumber,
					temporaryPin: generatedStudentPin,
				},
			};
			
			/*
			 * Include parent information in the import result
			 * when a parent was created.
			 *
			 * The generated password is returned only for this
			 * import response. It is never stored as plaintext.
			 */
			if (
				parentWasCreated &&
				transactionResult.parentProfile
			) {
				importedStudent.parent = {
					parentId:
					transactionResult.parentProfile.id,
					guardianName:
					guardianName || null,
					guardianPhone:
					guardianPhone || null,
					guardianEmail:
					guardianEmail || null,
					relationship:
					parentRelationship ||
					'Guardian',
				};
				
				if (generatedParentPassword) {
					importedStudent.parent.tempPassword =
					generatedParentPassword;
				}
			}
			
			result.importedStudents.push(
				importedStudent
			);
		} catch (error) {
			result.failedCount++;
			
			result.errors.push({
				rowNumber,
				admissionNumber,
				error: error.message,
			});
			
			/*
			 * Failed rows are also recorded.
			 */
			await prisma.importBatchStudent.create({
				data: {
					importBatchId: batch.id,
					rowNumber,
					admissionNumber,
					status: 'FAILED',
					errorMessage: error.message,
				},
			});
		}
	}
	
	/*
	 * Determine final batch status.
	 */
	let finalStatus = 'COMPLETED';
	
	if (
		result.successCount > 0 &&
		result.failedCount > 0
	) {
		finalStatus =
		'COMPLETED_WITH_ERRORS';
	} else if (result.failedCount > 0) {
		finalStatus = 'FAILED';
	}
	
	/*
	 * Update audit batch.
	 */
	await prisma.importBatch.update({
		where: {
			id: batch.id,
		},
		data: {
			successCount:
			result.successCount,
			failedCount:
			result.failedCount,
			status: finalStatus,
			completedAt: new Date(),
		},
	});
	
	return {
		batchId: batch.id,
		status: finalStatus,
		...result,
	};
}

module.exports = {
	importStudents,
};
