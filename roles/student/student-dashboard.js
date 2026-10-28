const studentToken =
  localStorage.getItem(
    'connectsukuu_student_token'
  );

if (!studentToken) {
  window.location.href =
    '/auth/student-signin.html';
}


/*
 * Dashboard elements.
 */
const welcomeHeading =
  document.getElementById(
    'welcomeHeading'
  );

const studentName =
  document.getElementById(
    'studentName'
  );

const schoolName =
  document.getElementById(
    'schoolName'
  );

const classLevel =
  document.getElementById(
    'classLevel'
  );

const studentAvatar =
  document.getElementById(
    'studentAvatar'
  );

const admissionNumber =
  document.getElementById(
    'admissionNumber'
  );

const profileName =
  document.getElementById(
    'profileName'
  );

const profileClass =
  document.getElementById(
    'profileClass'
  );

const profileStatus =
  document.getElementById(
    'profileStatus'
  );

const parentDetails =
  document.getElementById(
    'parentDetails'
  );


/*
 * Load the authenticated student's information.
 */
async function loadStudentPortal() {
  try {
    const response =
      await fetch(
        `${API_BASE}/api/student-portal/me`,
        {
          headers: {
            Authorization:
              `Bearer ${studentToken}`,
          },
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        'Unable to load student portal.'
      );
    }

    const student =
      data.student;

    const fullName =
      `${student.firstName} ${student.lastName}`;

    welcomeHeading.textContent =
      `Welcome, ${student.firstName}`;

    studentName.textContent =
      fullName;

    schoolName.textContent =
      student.school.name;

    classLevel.textContent =
      student.classLevel || '—';

    admissionNumber.textContent =
      student.admissionNumber;

    profileName.textContent =
      fullName;

    profileClass.textContent =
      student.classLevel || '—';

    profileStatus.textContent =
      student.status || 'ACTIVE';

    studentAvatar.textContent =
      `${student.firstName.charAt(0)}${student.lastName.charAt(0)}`;

    renderParents(
      student.parentRelationships || []
    );

  } catch (error) {
    console.error(
      'Student dashboard error:',
      error
    );

    /*
     * An invalid/expired student session
     * should send the student back to login.
     */
    localStorage.removeItem(
      'connectsukuu_student_token'
    );

    localStorage.removeItem(
      'connectsukuu_student'
    );

    window.location.href =
      '/auth/student-signin.html';
  }
}


/*
 * Render the student's linked parents/guardians.
 */
function renderParents(
  relationships
) {
  if (!relationships.length) {
    parentDetails.textContent =
      'No parent or guardian has been linked yet.';

    return;
  }

  parentDetails.innerHTML =
    relationships.map(
      (relationship) => {
        const parent =
          relationship.parent.user;

        const name =
          `${parent.firstName} ${parent.lastName}`;

        return `
          <div class="parent-card">
            <strong>
              ${name}
            </strong>

            <span>
              ${relationship.relationship || 'Guardian'}
              ${relationship.isPrimary ? ' • Primary' : ''}
            </span>

            <span>
              ${parent.phone || 'No phone number'}
            </span>
          </div>
        `;
      }
    ).join('');
}


/*
 * Student logout.
 */
document
  .getElementById('studentLogout')
  .addEventListener(
    'click',
    () => {
      localStorage.removeItem(
        'connectsukuu_student_token'
      );

      localStorage.removeItem(
        'connectsukuu_student'
      );

      window.location.href =
        '/auth/student-signin.html';
    }
  );


/*
 * Mobile sidebar.
 */
document
  .getElementById('mobileMenu')
  .addEventListener(
    'click',
    () => {
      document
        .querySelector('.sidebar')
        .classList.toggle('open');
    }
  );


loadStudentPortal();
