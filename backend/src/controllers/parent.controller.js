const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/db');

/**
 * Generate a temporary password for a newly created parent.
 */
function generateTempPassword() {
	return crypto.randomBytes(6).toString('base64url');
}


/**
 * GET /api/parents
 *
 * Lists parents belonging to the authenticated user's school.
 */
async function listParents(req, res) {
	try {
		const parents = await prisma.parentProfile.findMany({
			where: {
				schoolId: req.user.schoolId,
			},
			include: {
				user: {
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						phone: true,
						role: true,
						createdAt: true,
					},
				},
				_count: {
					select: {
						relationships: true,
					},
				},
			},
			orderBy: {
				createdAt: 'asc',
			},
		});
		
		res.json(parents);
	} catch (err) {
		console.error('listParents error:', err);
		
		res.status(500).json({
			error: 'Failed to load parents',
		});
	}
}


/**
 * POST /api/parents
 *
 * Creates a parent account and ParentProfile.
 *
 * Required:
 *   firstName
 *   lastName
 *
 * Contact:
 *   phone is the primary parent contact.
 *   email is optional very crucial.
 */
async function createParent(req, res) {
	try {
		const {
			firstName,
			lastName,
			phone,
			email,
			occupation,
			address,
		} = req.body;
		
		if (!firstName || !lastName || !phone) {
			return res.status(400).json({
				error: 'First name, last name and phone are required',
			});
		}
		
		const normalizedPhone = phone.trim();
		
		if (!normalizedPhone) {
			return res.status(400).json({
				error: 'Phone number is required',
			});
		}
		
		const normalizedEmail = email?.trim().toLowerCase() || null;
		
		//Check whether the email is already being used.
		if (normalizedEmail) {
			const existingEmail = await prisma.user.findUnique({
				where: {
					email: normalizedEmail,
				},
			});
			
			if (existingEmail) {
				return res.status(409).json({
					error: 'An account with this email already exists',
				});
			}
		}
		
		//Check whether this phone already belongs to a parent in sch
		const existingParent = await prisma.user.findFirst({
			where: {
				phone: normalizedPhone,
				schoolId: req.user.schoolId,
				role: 'PARENT',
			},
		});
		
		if (existingParent) {
			return res.status(409).json({
				error: 'A parent account with this phone number already exists',
			});
		}
		
		const tempPassword = generateTempPassword();
		
		const passwordHash = await bcrypt.hash(
			tempPassword,
			10
		);
		
		//Create the User and ParentProfile together.
		//If either operation fails, neither record is kept.
		const result = await prisma.$transaction(async (tx) => {
			const user = await tx.user.create({
				data: {
					firstName: firstName.trim(),
											  lastName: lastName.trim(),
											  email: normalizedEmail,
											  phone: normalizedPhone,
											  role: 'PARENT',
											  passwordHash,
											  mustChangePassword: true,
											  schoolId: req.user.schoolId,
				},
			});
			
			const parentProfile = await tx.parentProfile.create({
				data: {
					userId: user.id,
					schoolId: req.user.schoolId,
					occupation: occupation?.trim() || null,
																address: address?.trim() || null,
				},
			});
			
			return {
				user,
				parentProfile,
			};
		});
		
		res.status(201).json({
			id: result.parentProfile.id,
			userId: result.user.id,
			firstName: result.user.firstName,
			lastName: result.user.lastName,
			email: result.user.email,
			phone: result.user.phone,
			role: result.user.role,
			tempPassword,
		});
	} catch (err) {
		console.error('createParent error:', err);
		
		res.status(500).json({
			error: 'Failed to create parent',
		});
	}
}


/**
 * GET /api/parents/:id
 *
 * Gets one parent belonging to the authenticated user's school.
 */
async function getParent(req, res) {
	try {
		const parent = await prisma.parentProfile.findFirst({
			where: {
				id: req.params.id,
				schoolId: req.user.schoolId,
			},
			include: {
				user: {
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						phone: true,
						role: true,
						createdAt: true,
					},
				},
				relationships: {
					include: {
						student: {
							select: {
								id: true,
								admissionNumber: true,
								firstName: true,
								lastName: true,
								classLevel: true,
							},
						},
					},
				},
			},
		});
		
		if (!parent) {
			return res.status(404).json({
				error: 'Parent not found',
			});
		}
		
		res.json(parent);
	} catch (err) {
		console.error('getParent error:', err);
		
		res.status(500).json({
			error: 'Failed to load parent',
		});
	}
}


/**
 * PATCH /api/parents/:id
 *
 * Updates a parent's contact/profile information.
 */
async function updateParent(req, res) {
	try {
		const {
			firstName,
			lastName,
			phone,
			email,
			occupation,
			address,
		} = req.body;
		
		const parent = await prisma.parentProfile.findFirst({
			where: {
				id: req.params.id,
				schoolId: req.user.schoolId,
			},
			include: {
				user: true,
			},
		});
		
		if (!parent) {
			return res.status(404).json({
				error: 'Parent not found',
			});
		}
		
		const normalizedEmail =
		email !== undefined
		? (email?.trim().toLowerCase() || null)
		: undefined;
		
		if (normalizedEmail) {
			const existingEmail = await prisma.user.findFirst({
				where: {
					email: normalizedEmail,
					id: {
						not: parent.userId,
					},
				},
			});
			
			if (existingEmail) {
				return res.status(409).json({
					error: 'An account with this email already exists',
				});
			}
		}
		
		if (phone !== undefined) {
			const normalizedPhone = phone?.trim() || null;
			
			if (normalizedPhone) {
				const existingPhone = await prisma.user.findFirst({
					where: {
						phone: normalizedPhone,
						schoolId: req.user.schoolId,
						role: 'PARENT',
						id: {
							not: parent.userId,
						},
					},
				});
				
				if (existingPhone) {
					return res.status(409).json({
						error: 'A parent account with this phone number already exists',
					});
				}
			}
		}
		
		const updated = await prisma.$transaction(async (tx) => {
			const user = await tx.user.update({
				where: {
					id: parent.userId,
				},
				data: {
					...(firstName !== undefined && {
						firstName: firstName.trim(),
					}),
					...(lastName !== undefined && {
						lastName: lastName.trim(),
					}),
					...(phone !== undefined && {
						phone: phone?.trim() || null,
					}),
					...(email !== undefined && {
						email: normalizedEmail,
					}),
				},
			});
			
			const parentProfile = await tx.parentProfile.update({
				where: {
					id: parent.id,
				},
				data: {
					...(occupation !== undefined && {
						occupation: occupation?.trim() || null,
					}),
					...(address !== undefined && {
						address: address?.trim() || null,
					}),
				},
			});
			
			return {
				user,
				parentProfile,
			};
		});
		
		res.json({
			id: updated.parentProfile.id,
			userId: updated.user.id,
			firstName: updated.user.firstName,
			lastName: updated.user.lastName,
			email: updated.user.email,
			phone: updated.user.phone,
			role: updated.user.role,
			occupation: updated.parentProfile.occupation,
			address: updated.parentProfile.address,
		});
	} catch (err) {
		console.error('updateParent error:', err);
		
		res.status(500).json({
			error: 'Failed to update parent',
		});
	}
}


/**
 * DELETE /api/parents/:id
 *
 * Removes a parent account and its ParentProfile.
 */
async function removeParent(req, res) {
	try {
		const parent = await prisma.parentProfile.findFirst({
			where: {
				id: req.params.id,
				schoolId: req.user.schoolId,
			},
			include: {
				user: true,
			},
		});
		
		if (!parent) {
			return res.status(404).json({
				error: 'Parent not found',
			});
		}
		
		await prisma.$transaction(async (tx) => {
			await tx.parentStudent.deleteMany({
				where: {
					parentId: parent.id,
				},
			});
			
			await tx.parentProfile.delete({
				where: {
					id: parent.id,
				},
			});
			
			await tx.user.delete({
				where: {
					id: parent.userId,
				},
			});
		});
		
		res.json({
			message: 'Parent account removed successfully',
		});
	} catch (err) {
		console.error('removeParent error:', err);
		
		res.status(500).json({
			error: 'Failed to remove parent',
		});
	}
}


/**
 * GET /api/parents/:id/students
 *
 * Lists all students linked to a parent.
 */
async function listParentStudents(req, res) {
	try {
		const parent = await prisma.parentProfile.findFirst({
			where: {
				id: req.params.id,
				schoolId: req.user.schoolId,
			},
		});
		
		if (!parent) {
			return res.status(404).json({
				error: 'Parent not found',
			});
		}
		
		const relationships = await prisma.parentStudent.findMany({
			where: {
				parentId: parent.id,
			},
			include: {
				student: {
					select: {
						id: true,
						admissionNumber: true,
						firstName: true,
						lastName: true,
						classLevel: true,
					},
				},
			},
			orderBy: {
				createdAt: 'asc',
			},
		});
		
		res.json(relationships);
	} catch (err) {
		console.error('listParentStudents error:', err);
		
		res.status(500).json({
			error: 'Failed to load parent students',
		});
	}
}


module.exports = {
	listParents,
	createParent,
	getParent,
	updateParent,
	removeParent,
	listParentStudents,
};
