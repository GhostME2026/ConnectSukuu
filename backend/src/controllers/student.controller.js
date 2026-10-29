const prisma = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/*
 * STUDENT MANAGEMENT
 */

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}
function generateStudentPin() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateTemporaryPassword() {
  return crypto.randomBytes(6).toString('base64url');
}
/*
 * POST /api/students
 *
 * Creates a student.
 *
 * Optional enrollment fields:
 *   academicYearId
 *   termId
 *   classId
 */
async function createStudent(req, res) {
  try {
    const {
      admissionNumber,
      firstName,
      lastName,
      classLevel,
      guardianName,
      guardianPhone,
      guardianEmail,
      parentRelationship,
      parentPassword,
      branchId,
      academicYearId,
      termId,
      classId,
    } = req.body;
    
    if (!admissionNumber || !firstName || !lastName) {
      return res.status(400).json({
        error: 'Admission number, first name and last name are required',
      });
    }
    
    const cleanAdmissionNumber = clean(admissionNumber);
    const cleanFirstName = clean(firstName);
    const cleanLastName = clean(lastName);
    const cleanGuardianName = clean(guardianName);
  const cleanGuardianPhone = clean(guardianPhone);
    const cleanGuardianEmail = clean(guardianEmail)?.toLowerCase() || '';
    const cleanParentRelationship = clean(parentRelationship);
    const cleanParentPassword = clean(parentPassword);
    
    if (!cleanAdmissionNumber || !cleanFirstName || !cleanLastName) {
      return res.status(400).json({
        error: 'Required student fields cannot be empty',
      });
    }
    if (cleanGuardianEmail && !cleanParentRelationship) {
      return res.status(400).json({
        error: 'Parent relationship is required when a parent email is provided',
      });
    }
    
    if (cleanParentPassword && cleanParentPassword.length < 8) {
      return res.status(400).json({
        error: 'Parent temporary password must be at least 8 characters',
      });
    }
    
    /*
     * A classLevel is retained because it already exists in the schema.
     */
    let resolvedClassLevel = clean(classLevel);
    
    if (classId) {
      const schoolClass = await prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: req.user.schoolId,
        },
      });
      
      if (!schoolClass) {
        return res.status(404).json({
          error: 'Class not found',
        });
      }
      
      if (academicYearId && schoolClass.academicYearId !== academicYearId) {
        return res.status(400).json({
          error: 'The selected class does not belong to the selected academic year',
        });
      }
      
      resolvedClassLevel =
      resolvedClassLevel ||
      schoolClass.level ||
      schoolClass.name;
    }
    
    if (!resolvedClassLevel) {
      return res.status(400).json({
        error: 'Class level is required when no class is selected',
      });
    }
    
    /* Every newly enrolled student belongs to the administrator's assigned branch. */
    const effectiveBranchId = req.user.branchId;
    if (!effectiveBranchId) return res.status(403).json({ error: 'Assign this administrator to a branch before enrolling students.' });
    if (branchId && branchId !== effectiveBranchId) return res.status(403).json({ error: 'You can only enroll students into your assigned branch.' });
    const branch = await prisma.branch.findFirst({ where: { id: effectiveBranchId, schoolId: req.user.schoolId, status: 'ACTIVE' } });
    if (!branch) return res.status(403).json({ error: 'Your assigned branch is inactive or unavailable.' });
    
    /*
     * If enrollment information was supplied, validate everything
     * before creating the student.
     */
    let academicYear = null;
    let term = null;
    let schoolClass = null;
    
    if (academicYearId) {
      academicYear = await prisma.academicYear.findFirst({
        where: {
          id: academicYearId,
          schoolId: req.user.schoolId,
        },
      });
      
      if (!academicYear) {
        return res.status(404).json({
          error: 'Academic year not found',
        });
      }
    }
    
    if (termId) {
      term = await prisma.term.findFirst({
        where: {
          id: termId,
          academicYear: {
            schoolId: req.user.schoolId,
          },
        },
      });
      
      if (!term) {
        return res.status(404).json({
          error: 'Term not found',
        });
      }
      
      if (academicYearId && term.academicYearId !== academicYearId) {
        return res.status(400).json({
          error: 'The selected term does not belong to the selected academic year',
        });
      }
      
      if (!academicYearId) {
        academicYear = await prisma.academicYear.findFirst({
          where: {
            id: term.academicYearId,
            schoolId: req.user.schoolId,
          },
        });
      }
    }
    
    if (classId) {
      schoolClass = await prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: req.user.schoolId,
        },
      });
      
      if (!schoolClass) {
        return res.status(404).json({
          error: 'Class not found',
        });
      }
      
      if (academicYear && schoolClass.academicYearId !== academicYear.id) {
        return res.status(400).json({
          error: 'The selected class does not belong to the selected academic year',
        });
      }
      
      if (!academicYear) {
        academicYear = await prisma.academicYear.findFirst({
          where: {
            id: schoolClass.academicYearId,
            schoolId: req.user.schoolId,
          },
        });
      }
    }
    
    /*
     * An enrollment requires all three:
     * academic year + class.
     */
    if ((academicYearId || termId || classId) &&
      (!academicYear || !schoolClass)) {
      return res.status(400).json({
        error: 'Enrollment requires a valid academic year and class',
      });
      }
      
      try {
        // Prepare credentials before opening the transaction. bcrypt hashing is
        // intentionally expensive and should not hold a database connection.
        const temporaryStudentPin = generateStudentPin();
        const parentTemporaryPasswordCandidate = cleanGuardianEmail
          ? (cleanParentPassword || generateTemporaryPassword())
          : null;
        const [studentPinHash, parentPasswordHashCandidate] = await Promise.all([
          bcrypt.hash(temporaryStudentPin, 10),
          parentTemporaryPasswordCandidate
            ? bcrypt.hash(parentTemporaryPasswordCandidate, 10)
            : Promise.resolve(null),
        ]);

        const result = await prisma.$transaction(async (tx) => {
          const student = await tx.student.create({
            data: {
              schoolId: req.user.schoolId,
              branchId: effectiveBranchId,
              admissionNumber: cleanAdmissionNumber,
              firstName: cleanFirstName,
              lastName: cleanLastName,
              classLevel: resolvedClassLevel,
              guardianName: cleanGuardianName || null,
              guardianPhone: cleanGuardianPhone || null,
            },
          });
          
        await tx.studentAccess.create({
          data: {
            studentId: student.id,
            pinHash: studentPinHash,
            enabled: true,
          },
        });

        let parentProfile = null;
        let parentAccountCreated = false;
        let parentTemporaryPassword = null;

        if (cleanGuardianEmail) {
          const existingParentUser = await tx.user.findUnique({
            where: {
              email: cleanGuardianEmail,
            },
            include: {
              parentProfile: true,
            },
          });

          if (existingParentUser) {
            if (existingParentUser.role !== 'PARENT') {
              throw new Error('PARENT_EMAIL_ALREADY_IN_USE');
            }

            if (
              !existingParentUser.parentProfile ||
              existingParentUser.parentProfile.schoolId !== req.user.schoolId
            ) {
              throw new Error('PARENT_ACCOUNT_SCHOOL_MISMATCH');
            }

            parentProfile = existingParentUser.parentProfile;
          } else {
            parentTemporaryPassword = parentTemporaryPasswordCandidate;
            const parentPasswordHash = parentPasswordHashCandidate;

            const guardianParts = (cleanGuardianName || '').split(/\s+/);
            const parentFirstName =
              guardianParts.shift() || cleanFirstName;
            const parentLastName =
              guardianParts.join(' ') || cleanLastName;

            const parentUser = await tx.user.create({
              data: {
                email: cleanGuardianEmail,
                phone: cleanGuardianPhone || null,
                passwordHash: parentPasswordHash,
                firstName: parentFirstName,
                lastName: parentLastName,
                role: 'PARENT',
                mustChangePassword: true,
                schoolId: req.user.schoolId,
              },
            });

            parentProfile = await tx.parentProfile.create({
              data: {
                userId: parentUser.id,
                schoolId: req.user.schoolId,
              },
            });

            parentAccountCreated = true;
          }

          await tx.parentStudent.create({
            data: {
              parentId: parentProfile.id,
              studentId: student.id,
              relationship: cleanParentRelationship,
              isPrimary: true,
              canReceiveNotifications: true,
            },
          });
        }

        let enrollment = null;
          
          if (academicYear && schoolClass) {
            /*
             * Prevent duplicate enrollment for the same student etc
             */
            const existingEnrollment = await tx.enrollment.findFirst({
              where: {
                schoolId: req.user.schoolId,
                studentId: student.id,
                academicYearId: academicYear.id,
                classId: schoolClass.id,
                ...(termId ? { termId } : {}),
              },
            });
            
            if (existingEnrollment) {
              throw new Error('DUPLICATE_ENROLLMENT');
            }
            
            enrollment = await tx.enrollment.create({
              data: {
                schoolId: req.user.schoolId,
                studentId: student.id,
                academicYearId: academicYear.id,
                termId: termId || null,
                classId: schoolClass.id,
                status: 'ACTIVE',
              },
              include: {
                academicYear: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                term: {
                  select: {
                    id: true,
                    name: true,
                    isCurrent: true,
                  },
                },
                schoolClass: {
                  select: {
                    id: true,
                    name: true,
                    level: true,
                    section: true,
                  },
                },
              },
            });
          }
          
        return {
          student,
          enrollment,
          credentials: {
            student: {
              username: cleanAdmissionNumber,
              temporaryPin: temporaryStudentPin,
            },
            parent: cleanGuardianEmail && parentAccountCreated
              ? {
                  email: cleanGuardianEmail,
                  temporaryPassword: parentTemporaryPassword,
                }
              : cleanGuardianEmail && parentProfile
                ? {
                    email: cleanGuardianEmail,
                    accountCreated: false,
                    message: "Existing parent account linked. No new password was generated.",
                  }
                : null,
          },
        };
        }, { maxWait: 10000, timeout: 20000 });
        
        return res.status(201).json(result);
      } catch (err) {
      if (err.message === "PARENT_EMAIL_ALREADY_IN_USE") {
        return res.status(409).json({
          error: "The parent email is already being used by a non-parent account",
          code: "PARENT_EMAIL_ALREADY_IN_USE",
        });
      }

      if (err.message === "PARENT_ACCOUNT_SCHOOL_MISMATCH") {
        return res.status(409).json({
          error: "The existing parent account belongs to another school",
          code: "PARENT_ACCOUNT_SCHOOL_MISMATCH",
        });
      }

        if (err.message === 'DUPLICATE_ENROLLMENT') {
          return res.status(409).json({
            error: 'This student is already enrolled in the selected class and academic period',
          });
        }
        
        if (err.code === 'P2002') {
          const target = Array.isArray(err.meta?.target)
            ? err.meta.target.join(', ')
            : String(err.meta?.target || '');

          if (target.toLowerCase().includes('email')) {
            return res.status(409).json({
              error: 'The parent email is already in use. Use another email or link the existing parent account.',
              code: 'PARENT_EMAIL_CONFLICT',
            });
          }

          if (target.toLowerCase().includes('admission')) {
            return res.status(409).json({
              error: 'A student with this admission number already exists in your school',
              code: 'STUDENT_ADMISSION_CONFLICT',
            });
          }

          return res.status(409).json({
            error: 'The student could not be created because a unique record already exists. Please check the admission number and parent email.',
            code: 'STUDENT_UNIQUE_CONFLICT',
          });
        }
        
        throw err;
      }
  } catch (err) {
    console.error('createStudent error:', err);

    if (err.code === 'P2028') {
      return res.status(503).json({
        error: 'Student creation timed out while processing the school records. Please try again.',
        code: 'STUDENT_CREATION_TIMEOUT',
      });
    }

    if (err.code === 'P2003') {
      return res.status(400).json({
        error: 'Student creation could not complete because one of the selected academic records is no longer available.',
        code: 'ACADEMIC_RECORD_REFERENCE_ERROR',
      });
    }

    res.status(500).json({
      error: 'Failed to create student. Check the backend log for the underlying error.',
      code: 'STUDENT_CREATION_ERROR',
    });
  }
}


/*
 * GET /api/students
 *
 * Lists students belonging to the current school.
 */
async function listStudents(req, res) {
  try {
    const {
      search,
      classId,
      academicYearId,
      status,
    } = req.query;
    
    const where = {
      schoolId: req.user.schoolId,
      branchId: req.user.branchId || '__NO_BRANCH__',
    };
    
    /*
     * Search admission number, first name or last name.
     */
    if (search && search.trim()) {
      const term = search.trim();
      
      where.OR = [
        {
          admissionNumber: {
            contains: term,
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: term,
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: term,
            mode: 'insensitive',
          },
        },
      ];
    }
    
    /*
     * Filter by enrollment.
     */
    if (classId || academicYearId || status) {
      where.enrollments = {
        some: {
          ...(classId ? { classId } : {}),
          ...(academicYearId ? { academicYearId } : {}),
          ...(status ? { status } : {}),
        },
      };
    }
    
    const students = await prisma.student.findMany({
      where,
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        
        enrollments: {
          orderBy: {
            enrolledAt: 'desc',
          },
          take: 1,
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
            term: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
            schoolClass: {
              select: {
                id: true,
                name: true,
                level: true,
                section: true,
              },
            },
          },
        },
        
        parentRelationships: {
          include: {
            parent: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
        
        access: {
          select: {
            id: true,
            enabled: true,
            lastLoginAt: true,
          },
        },
      },
      
      orderBy: [
        {
          lastName: 'asc',
        },
        {
          firstName: 'asc',
        },
      ],
    });
    
    res.json(students);
  } catch (err) {
    console.error('listStudents error:', err);
    
    res.status(500).json({
      error: 'Failed to load students',
    });
  }
}


/*
 * GET /api/students/:id
 */
async function getStudent(req, res) {
  try {
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
        branchId: req.user.branchId || '__NO_BRANCH__',
      },
      
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        
        enrollments: {
          orderBy: {
            enrolledAt: 'desc',
          },
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
                startsAt: true,
                endsAt: true,
                isCurrent: true,
              },
            },
            term: {
              select: {
                id: true,
                name: true,
                startsAt: true,
                endsAt: true,
                isCurrent: true,
              },
            },
            schoolClass: {
              select: {
                id: true,
                name: true,
                level: true,
                section: true,
              },
            },
          },
        },
        
        parentRelationships: {
          include: {
            parent: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        
        access: {
          select: {
            id: true,
            enabled: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        
        feeRecords: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
        
        scholarships: true,
      },
    });
    
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    res.json(student);
  } catch (err) {
    console.error('getStudent error:', err);
    
    res.status(500).json({
      error: 'Failed to load student',
    });
  }
}


/*
 * PATCH /api/students/:id
 *
 * Updates basic student information.
 */
async function updateStudent(req, res) {
  try {
    const {
      firstName,
      lastName,
      classLevel,
      guardianName,
      guardianPhone,
      branchId,
      photoUrl,
    } = req.body;
    
    const existing = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
        branchId: req.user.branchId || '__NO_BRANCH__',
      },
    });
    
    if (!existing) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    if (branchId && branchId !== existing.branchId) return res.status(409).json({ error: 'Student branch transfers require a separate audited transfer workflow.' });
    
    const data = {};
    
    if (firstName !== undefined) {
      data.firstName = clean(firstName);
    }
    
    if (lastName !== undefined) {
      data.lastName = clean(lastName);
    }
    
    if (classLevel !== undefined) {
      data.classLevel = clean(classLevel);
    }
    
    if (guardianName !== undefined) {
      data.guardianName = clean(guardianName) || null;
    }
    
    if (guardianPhone !== undefined) {
      data.guardianPhone = clean(guardianPhone) || null;
    }
    
    if (branchId !== undefined) {
      data.branchId = branchId || null;
    }
    
    if (photoUrl !== undefined) {
      const normalizedPhoto = clean(photoUrl);
      // Student profile images are stored as data URLs in the existing photoUrl
      // column. Bound payload size to protect the API and database from large uploads.
      if (normalizedPhoto && normalizedPhoto.length > 2800000) {
        return res.status(413).json({ error: 'Student profile photos must be 2 MB or smaller.' });
      }
      if (normalizedPhoto && normalizedPhoto.startsWith('data:') && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(normalizedPhoto)) {
        return res.status(400).json({ error: 'Use a PNG, JPG, WEBP or GIF image.' });
      }
      data.photoUrl = normalizedPhoto || null;
    }
    
    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: 'No changes were supplied',
      });
    }
    
    const updated = await prisma.student.update({
      where: {
        id: existing.id,
      },
      data,
    });
    
    res.json(updated);
  } catch (err) {
    console.error('updateStudent error:', err);
    
    res.status(500).json({
      error: 'Failed to update student',
    });
  }
}



/*
 * POST /api/students/:id/photo
 * Store a student photo as a bounded image file and save only its URL in the database.
 */
async function updateStudentPhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose a student photo to upload.' });
  try {
    const existing = await prisma.student.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId },
      select: { id: true, photoUrl: true },
    });
    if (!existing) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ error: 'Student not found.' });
    }
    const photoUrl = `/uploads/student-profiles/${req.file.filename}`;
    const updated = await prisma.student.update({ where: { id: existing.id }, data: { photoUrl }, select: { id: true, photoUrl: true } });
    const oldUrl = String(existing.photoUrl || '');
    if (oldUrl.startsWith('/uploads/student-profiles/')) {
      const root = path.resolve(__dirname, '../../uploads/student-profiles');
      const oldPath = path.resolve(root, path.basename(oldUrl));
      if (oldPath.startsWith(root + path.sep) && oldPath !== path.resolve(req.file.path) && fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }
    return res.json(updated);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('updateStudentPhoto error:', err);
    return res.status(500).json({ error: 'Unable to save student photo.' });
  }
}

/*
 * PERMANENT STUDENT DELETION
 *
 * Removes the student and records owned by that student.
 * Unrelated parent accounts are deliberately preserved.
 */
async function permanentlyDeleteStudentRecord(tx, studentId, schoolId) {
  const student = await tx.student.findFirst({
    where: {
      id: studentId,
      schoolId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
    },
  });

  if (!student) {
    return null;
  }

  // Payments depend on StudentFee, so remove them first.
  const studentFees = await tx.studentFee.findMany({
    where: {
      studentId: student.id,
      schoolId,
    },
    select: {
      id: true,
    },
  });

  if (studentFees.length) {
    await tx.feePayment.deleteMany({
      where: {
        studentFeeId: {
          in: studentFees.map((fee) => fee.id),
        },
        schoolId,
      },
    });

    await tx.studentFee.deleteMany({
      where: {
        studentId: student.id,
        schoolId,
      },
    });
  }

  // Remove other student-owned records.
  await tx.enrollment.deleteMany({
    where: {
      studentId: student.id,
      schoolId,
    },
  });

  await tx.scholarship.deleteMany({
    where: {
      studentId: student.id,
      schoolId,
    },
  });

  await tx.parentStudent.deleteMany({
    where: {
      studentId: student.id,
    },
  });

  await tx.studentAccess.deleteMany({
    where: {
      studentId: student.id,
    },
  });

  // Preserve ImportBatch records, but remove their student reference.
  await tx.importBatchStudent.deleteMany({
    where: {
      studentId: student.id,
    },
  });

  // Finally remove the student.
  await tx.student.delete({
    where: {
      id: student.id,
    },
  });

  return student;
}


/*
 * DELETE /api/students/:id
 *
 * Permanently removes a student and student-owned records.
 */
async function removeStudent(req, res) {
  try {
    const schoolId = req.user.schoolId;
    const studentId = req.params.id;

    if (!schoolId) {
      return res.status(403).json({
        error: 'A school context is required.',
      });
    }

    const deletedStudent = await prisma.$transaction((tx) =>
      permanentlyDeleteStudentRecord(
        tx,
        studentId,
        schoolId
      )
    );

    if (!deletedStudent) {
      return res.status(404).json({
        error: 'Student not found.',
      });
    }

    res.json({
      success: true,
      message: 'Student and related student records were permanently deleted.',
      student: deletedStudent,
    });
  } catch (err) {
    console.error('removeStudent error:', err);

    res.status(500).json({
      error: 'Failed to permanently delete student.',
    });
  }
}


/*
 * DELETE /api/students/bulk
 *
 * Permanently removes multiple students in one transaction.
 */
async function permanentlyDeleteStudentsBulk(req, res) {
  try {
    const schoolId = req.user.schoolId;

    const rawIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds
      : [];

    const studentIds = [
      ...new Set(
        rawIds
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      ),
    ];

    if (!schoolId) {
      return res.status(403).json({
        error: 'A school context is required.',
      });
    }

    if (!studentIds.length) {
      return res.status(400).json({
        error: 'No students were selected.',
      });
    }

    if (studentIds.length > 100) {
      return res.status(400).json({
        error: 'You can permanently delete a maximum of 100 students at once.',
      });
    }

    const deletedStudents = await prisma.$transaction(async (tx) => {
      const deleted = [];

      for (const studentId of studentIds) {
        const student = await permanentlyDeleteStudentRecord(
          tx,
          studentId,
          schoolId
        );

        if (student) {
          deleted.push(student);
        }
      }

      return deleted;
    }, { maxWait: 10000, timeout: 20000 });
    res.json({
        success: true,
      message: `${deletedStudents.length} student${deletedStudents.length === 1 ? '' : 's'} permanently deleted.`,
      count: deletedStudents.length,
      students: deletedStudents,
    });
  } catch (err) {
    console.error(
      'permanentlyDeleteStudentsBulk error:',
      err
    );

    res.status(500).json({
      error: 'Failed to permanently delete selected students.',
    });
  }
}

/*
 * PATCH /api/students/:id/status
 *
 * Updates the student's lifecycle status from ACTIVE - WITHDRAW
 */
async function updateStudentStatus(req, res) {
  try {
    const { status } = req.body;
    
    const allowedStatuses = [
      'ACTIVE',
      'INACTIVE',
      'TRANSFERRED',
      'GRADUATED',
      'WITHDRAWN',
    ];
    
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid student status',
        allowedStatuses,
      });
    }
    
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    if (student.status === status) {
      return res.status(400).json({
        error: `Student is already marked as ${status}`,
      });
    }
    
    const updated = await prisma.student.update({
      where: {
        id: student.id,
      },
      data: {
        status,
      },
    });
    
    res.json({
      success: true,
      student: updated,
      previousStatus: student.status,
      status: updated.status,
    });
  } catch (err) {
    console.error('updateStudentStatus error:', err);
    
    res.status(500).json({
      error: 'Failed to update student status',
    });
  }
}


/*
 * GET /api/students/:id/enrollments
 */
async function listStudentEnrollments(req, res) {
  try {
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        schoolId: req.user.schoolId,
      },
      
      include: {
        academicYear: {
          select: {
            id: true,
            name: true,
            startsAt: true,
            endsAt: true,
            isCurrent: true,
          },
        },
        
        term: {
          select: {
            id: true,
            name: true,
            startsAt: true,
            endsAt: true,
            isCurrent: true,
          },
        },
        
        schoolClass: {
          select: {
            id: true,
            name: true,
            level: true,
            section: true,
          },
        },
      },
      
      orderBy: {
        enrolledAt: 'desc',
      },
    });
    
    res.json(enrollments);
  } catch (err) {
    console.error('listStudentEnrollments error:', err);
    
    res.status(500).json({
      error: 'Failed to load enrollment history',
    });
  }
}


/*
 * POST /api/students/:id/enrollments
 *
 * Adds a student to a class for an academic year/term.
 */
async function createEnrollment(req, res) {
  try {
    const {
      academicYearId,
      termId,
      classId,
      status = 'ACTIVE',
    } = req.body;
    
    if (!academicYearId || !classId) {
      return res.status(400).json({
        error: 'Academic year and class are required',
      });
    }
    
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        id: academicYearId,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!academicYear) {
      return res.status(404).json({
        error: 'Academic year not found',
      });
    }
    
    const schoolClass = await prisma.schoolClass.findFirst({
      where: {
        id: classId,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!schoolClass) {
      return res.status(404).json({
        error: 'Class not found',
      });
    }
    
    if (schoolClass.academicYearId !== academicYear.id) {
      return res.status(400).json({
        error: 'The selected class does not belong to the selected academic year',
      });
    }
    
    if (termId) {
      const term = await prisma.term.findFirst({
        where: {
          id: termId,
          academicYearId: academicYear.id,
          academicYear: {
            schoolId: req.user.schoolId,
          },
        },
      });
      
      if (!term) {
        return res.status(404).json({
          error: 'Term not found for the selected academic year',
        });
      }
    }
    
    /*
     * Prevent duplicate enrollment for the same academic context.
     */
    const duplicate = await prisma.enrollment.findFirst({
      where: {
        studentId: student.id,
        schoolId: req.user.schoolId,
        academicYearId,
        classId,
        status: 'ACTIVE',
        ...(termId ? { termId } : {}),
      },
    });
    
    if (String(status).toUpperCase() === 'ACTIVE' && duplicate) {
      return res.status(409).json({
        error: 'This student is already enrolled in the selected class and academic period',
      });
    }
    
    const enrollment = await prisma.$transaction(async (tx) => {
      // A student can have only one active class placement per academic year.
      // Prior placements remain in history but become inactive on transfer.
      if (String(status).toUpperCase() === 'ACTIVE') {
        await tx.enrollment.updateMany({
          where: { schoolId: req.user.schoolId, studentId: student.id, academicYearId, status: 'ACTIVE' },
          data: { status: 'INACTIVE' },
        });
      }
      const created = await tx.enrollment.create({
        data: {
          schoolId: req.user.schoolId,
          studentId: student.id,
          academicYearId,
          termId: termId || null,
          classId,
          status: String(status).toUpperCase(),
        },
        include: {
          academicYear: { select: { id: true, name: true, isCurrent: true } },
          term: { select: { id: true, name: true, isCurrent: true } },
          schoolClass: { select: { id: true, name: true, level: true, section: true } },
        },
      });
      if (String(status).toUpperCase() === 'ACTIVE') {
        await tx.student.update({ where: { id: student.id }, data: { classLevel: schoolClass.level || schoolClass.name } });
      }
      return created;
    }, { maxWait: 10000, timeout: 15000 });
    
    res.status(201).json(enrollment);
  } catch (err) {
    console.error('createEnrollment error:', err);
    
    res.status(500).json({
      error: 'Failed to create enrollment',
    });
  }
}


/*
 * PATCH /api/students/:id/enrollments/:enrollmentId
 *
 * Used primarily to change enrollment status.
 */
async function updateEnrollment(req, res) {
  try {
    const { status, classId, termId } = req.body;
    
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        id: req.params.enrollmentId,
        studentId: req.params.id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!enrollment) {
      return res.status(404).json({
        error: 'Enrollment not found',
      });
    }
    
    const data = {};
    
    if (status !== undefined) {
      const allowedStatuses = [
        'ACTIVE',
        'INACTIVE',
        'TRANSFERRED',
        'GRADUATED',
        'WITHDRAWN',
      ];
      
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid enrollment status',
        });
      }
      
      data.status = status;
    }
    
    if (classId !== undefined) {
      const schoolClass = await prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: req.user.schoolId,
        },
      });
      
      if (!schoolClass) {
        return res.status(404).json({
          error: 'Class not found',
        });
      }
      
      if (schoolClass.academicYearId !== enrollment.academicYearId) {
        return res.status(400).json({
          error: 'The selected class does not belong to this enrollment year',
        });
      }
      
      data.classId = classId;
    }
    
    if (termId !== undefined) {
      if (termId === null || termId === '') {
        data.termId = null;
      } else {
        const term = await prisma.term.findFirst({
          where: {
            id: termId,
            academicYearId: enrollment.academicYearId,
            academicYear: {
              schoolId: req.user.schoolId,
            },
          },
        });
        
        if (!term) {
          return res.status(404).json({
            error: 'Term not found',
          });
        }
        
        data.termId = termId;
      }
    }
    
    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: 'No enrollment changes were supplied',
      });
    }
    
    const effectiveStatus = data.status !== undefined ? data.status : enrollment.status;
    const updated = await prisma.$transaction(async (tx) => {
      if (effectiveStatus === 'ACTIVE' && (data.status === 'ACTIVE' || data.classId !== undefined || data.termId !== undefined)) {
        await tx.enrollment.updateMany({
          where: { schoolId: req.user.schoolId, studentId: enrollment.studentId, academicYearId: enrollment.academicYearId, status: 'ACTIVE', id: { not: enrollment.id } },
          data: { status: 'INACTIVE' },
        });
      }
      const row = await tx.enrollment.update({
        where: { id: enrollment.id },
        data,
        include: {
          academicYear: { select: { id: true, name: true, isCurrent: true } },
          term: { select: { id: true, name: true, isCurrent: true } },
          schoolClass: { select: { id: true, name: true, level: true, section: true } },
        },
      });
      if (row.status === 'ACTIVE' && row.schoolClass) {
        await tx.student.update({ where: { id: enrollment.studentId }, data: { classLevel: row.schoolClass.level || row.schoolClass.name } });
      }
      return row;
    }, { maxWait: 10000, timeout: 15000 });
    
    res.json(updated);
  } catch (err) {
    console.error('updateEnrollment error:', err);
    
    res.status(500).json({
      error: 'Failed to update enrollment',
    });
  }
}


/*
 * GET /api/students/:id/parents
 */
async function listStudentParents(req, res) {
  try {
    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
      },
    });
    
    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }
    
    const relationships = await prisma.parentStudent.findMany({
      where: {
        studentId: student.id,
        parent: {
          schoolId: req.user.schoolId,
        },
      },
      
      include: {
        parent: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                role: true,
              },
            },
          },
        },
      },
      
      orderBy: {
        createdAt: 'asc',
      },
    });
    
    res.json(relationships);
  } catch (err) {
    console.error('listStudentParents error:', err);
    
    res.status(500).json({
      error: 'Failed to load student parents',
    });
  }
}


/*
 * POST /api/students/:id/parents
 *
 * Links an existing ParentProfile to a student.
 * }
 */
async function addStudentParent(req, res) {
  try {
    const {
      parentId,
      firstName,
      lastName,
      phone,
      email,
      relationship,
      parentPassword,
      isPrimary = false,
      canReceiveNotifications = true,
    } = req.body;

    const schoolId = req.user.schoolId;
    const cleanFirstName = clean(firstName);
    const cleanLastName = clean(lastName);
    const cleanPhone = clean(phone);
    const cleanEmail = clean(email)?.toLowerCase() || '';
    const cleanRelationship = clean(relationship);
    const cleanParentPassword = clean(parentPassword);

    if (!schoolId) {
      return res.status(403).json({
        error: 'School context is required',
      });
    }

    if (!cleanRelationship) {
      return res.status(400).json({
        error: 'Guardian relationship is required',
      });
    }

    const student = await prisma.student.findFirst({
      where: {
        id: req.params.id,
        schoolId,
      },
    });

    if (!student) {
      return res.status(404).json({
        error: 'Student not found',
      });
    }

    let parentProfile = null;
    let parentAccountCreated = false;
    let temporaryPassword = null;

    /*
     * Existing-account mode: retain support for callers that already
     * have a ParentProfile id.
     */
    if (parentId) {
      parentProfile = await prisma.parentProfile.findFirst({
        where: {
          id: parentId,
          schoolId,
        },
        include: {
          user: true,
        },
      });

      if (!parentProfile) {
        return res.status(404).json({
          error: 'Parent profile not found',
        });
      }

      if (parentProfile.user.role !== 'PARENT') {
        return res.status(400).json({
          error: 'The selected account is not a parent account',
        });
      }
    } else {
      /*
       * New guardian mode: the frontend supplies guardian details.
       * An email lets us create/reuse a real parent portal account.
       * A phone-only guardian is also supported as a non-login contact.
       */
      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({
          error: 'Guardian first name and last name are required',
        });
      }

      if (!cleanEmail && !cleanPhone) {
        return res.status(400).json({
          error: 'Provide an email address or phone number for the guardian',
        });
      }

      if (cleanParentPassword && cleanParentPassword.length < 8) {
        return res.status(400).json({
          error: 'Guardian temporary password must be at least 8 characters',
        });
      }

      if (cleanEmail) {
        const existingParentUser = await prisma.user.findUnique({
          where: { email: cleanEmail },
          include: { parentProfile: true },
        });

        if (existingParentUser) {
          if (existingParentUser.role !== 'PARENT') {
            return res.status(409).json({
              error: 'The guardian email is already being used by a non-parent account',
              code: 'PARENT_EMAIL_ALREADY_IN_USE',
            });
          }

          if (
            !existingParentUser.parentProfile ||
            existingParentUser.parentProfile.schoolId !== schoolId
          ) {
            return res.status(409).json({
              error: 'The existing parent account belongs to another school',
              code: 'PARENT_ACCOUNT_SCHOOL_MISMATCH',
            });
          }

          parentProfile = existingParentUser.parentProfile;
        }
      }

      if (!parentProfile) {
        temporaryPassword =
          cleanParentPassword || generateTemporaryPassword();

        const passwordHash = await bcrypt.hash(temporaryPassword, 10);

        const parentUser = await prisma.user.create({
          data: {
            email: cleanEmail || null,
            phone: cleanPhone || null,
            passwordHash,
            firstName: cleanFirstName,
            lastName: cleanLastName,
            role: 'PARENT',
            mustChangePassword: true,
            schoolId,
          },
        });

        parentProfile = await prisma.parentProfile.create({
          data: {
            userId: parentUser.id,
            schoolId,
          },
        });

        parentAccountCreated = true;
      }
    }

    const existing = await prisma.parentStudent.findUnique({
      where: {
        parentId_studentId: {
          parentId: parentProfile.id,
          studentId: student.id,
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: 'This parent is already linked to this student',
      });
    }

    const relationshipRecord = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.parentStudent.updateMany({
          where: { studentId: student.id },
          data: { isPrimary: false },
        });
      }

      return tx.parentStudent.create({
        data: {
          parentId: parentProfile.id,
          studentId: student.id,
          relationship: cleanRelationship,
          isPrimary: Boolean(isPrimary),
          canReceiveNotifications: Boolean(canReceiveNotifications),
        },
        include: {
          parent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  role: true,
                },
              },
            },
          },
        },
      });
    });

    return res.status(201).json({
      relationship: relationshipRecord,
      credentials: parentAccountCreated
        ? {
            email: cleanEmail || null,
            temporaryPassword,
          }
        : parentProfile.user?.email
          ? {
              email: parentProfile.user.email,
              accountCreated: false,
              message: 'Existing parent account linked. No new password was generated.',
            }
          : null,
    });
  } catch (err) {
    console.error('addStudentParent error:', err);

    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'This guardian account or relationship already exists',
        code: 'PARENT_RELATIONSHIP_CONFLICT',
      });
    }

    return res.status(500).json({
      error: 'Failed to add parent/guardian',
    });
  }
}


/*
 * DELETE /api/students/:id/parents/:parentId
 */
async function removeStudentParent(req, res) {
  try {
    const relationship = await prisma.parentStudent.findFirst({
      where: {
        studentId: req.params.id,
        parentId: req.params.parentId,
        student: {
          schoolId: req.user.schoolId,
        },
      },
    });
    
    if (!relationship) {
      return res.status(404).json({
        error: 'Parent relationship not found',
      });
    }
    
    await prisma.parentStudent.delete({
      where: {
        id: relationship.id,
      },
    });
    
    res.json({
      success: true,
    });
  } catch (err) {
    console.error('removeStudentParent error:', err);
    
    res.status(500).json({
      error: 'Failed to remove parent relationship',
    });
  }
}



/*
 * POST /api/students/:id/reset-pin
 * Generates a 6-digit, single-use student sign-in PIN valid for 30 minutes.
 * The student's permanent PIN hash is deliberately left unchanged.
 */
async function resetStudentPin(req, res) {
  try {
    const studentId = String(req.params.id || '').trim();
    if (!studentId) return res.status(400).json({ error: 'Student ID is required' });

    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId, branchId: req.user.branchId || '__NO_BRANCH__' },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        lastName: true,
        status: true,
        access: { select: { id: true, enabled: true, pinHash: true } },
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found in your school' });
    if (student.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'A temporary PIN can only be generated for an active student' });
    }
    if (!student.access || !student.access.enabled) {
      return res.status(409).json({ error: 'This student does not have enabled student portal access' });
    }

    let temporaryPin = generateStudentPin();
    // Avoid matching the permanent PIN so the temporary credential is always consumed as temporary.
    while (await bcrypt.compare(temporaryPin, student.access.pinHash)) {
      temporaryPin = generateStudentPin();
    }
    const temporaryPinHash = await bcrypt.hash(temporaryPin, 10);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.studentAccess.update({
      where: { studentId: student.id },
      data: { temporaryPinHash, temporaryPinExpiresAt: expiresAt },
    });

    return res.status(200).json({
      message: 'One-time student PIN generated. It can be used once and expires in 30 minutes.',
      temporaryPin,
      expiresAt: expiresAt.toISOString(),
      student: {
        id: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
      },
    });
  } catch (err) {
    console.error('resetStudentPin error:', err);
    return res.status(500).json({ error: 'Failed to generate a temporary student PIN' });
  }
}

module.exports = {
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
};
