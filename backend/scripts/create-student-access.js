const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = require('../src/config/db');

/*
 * Generates an 8-character temporary student PIN.
 */
function generateStudentPin() {
  return crypto.randomBytes(4).toString('hex');
}

async function main() {
  console.log('Checking students without StudentAccess...\n');

  const students = await prisma.student.findMany({
    where: {
      access: null,
    },
    select: {
      id: true,
      admissionNumber: true,
      firstName: true,
      lastName: true,
    },
    orderBy: {
      admissionNumber: 'asc',
    },
  });

  if (!students.length) {
    console.log(
      'All students already have StudentAccess records.'
    );

    return;
  }

  console.log(
    `Found ${students.length} student(s) without portal access.\n`
  );

  const credentials = [];

  for (const student of students) {
    const pin = generateStudentPin();

    const pinHash = await bcrypt.hash(
      pin,
      12
    );

    await prisma.studentAccess.create({
      data: {
        studentId: student.id,
        pinHash,
        enabled: true,
      },
    });

    credentials.push({
      admissionNumber: student.admissionNumber,
      name: `${student.firstName} ${student.lastName}`,
      temporaryPin: pin,
    });
  }

  console.log(
    'StudentAccess records created successfully.\n'
  );

  console.log(
    'TEMPORARY STUDENT PORTAL CREDENTIALS'
  );

  console.log(
    '====================================='
  );

  for (const credential of credentials) {
    console.log(
      `${credential.name} | ${credential.admissionNumber} | PIN: ${credential.temporaryPin}`
    );
  }

  console.log(
    '\nIMPORTANT: Save these credentials securely.'
  );

  console.log(
    'The PINs are not stored in plaintext in the database.'
  );
}

main()
  .catch((error) => {
    console.error(
      'Failed to create StudentAccess:',
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
