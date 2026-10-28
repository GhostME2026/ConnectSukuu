(function () {
  const form =
    document.getElementById(
      'studentSigninForm'
    );

  const button =
    document.getElementById(
      'signinButton'
    );

  const message =
    document.getElementById(
      'signinMessage'
    );

  const schoolCodeInput =
    document.getElementById(
      'schoolCode'
    );

  const admissionInput =
    document.getElementById(
      'admissionNumber'
    );

  const pinInput =
    document.getElementById(
      'studentPin'
    );

  const togglePin =
    document.getElementById(
      'togglePin'
    );

  /*
   * Student sessions are deliberately
   * stored separately from staff sessions.
   */
  const STUDENT_TOKEN_KEY =
    'connectsukuu_student_token';

  const STUDENT_DATA_KEY =
    'connectsukuu_student';

  /*
   * Password/PIN visibility.
   */
  togglePin.addEventListener(
    'click',
    function () {
      const showing =
        pinInput.type === 'text';

      pinInput.type =
        showing
          ? 'password'
          : 'text';

      togglePin.textContent =
        showing
          ? 'Show'
          : 'Hide';

      togglePin.setAttribute(
        'aria-label',
        showing
          ? 'Show password'
          : 'Hide password'
      );
    }
  );

  form.addEventListener(
    'submit',
    async function (event) {
      event.preventDefault();

      message.textContent = '';

      const schoolCode =
        schoolCodeInput.value
          .trim()
          .toUpperCase();

      const admissionNumber =
        admissionInput.value
          .trim();

      const pin =
        pinInput.value;

      if (
        schoolCode.length < 3 ||
        schoolCode.length > 6
      ) {
        message.textContent =
          'School code must be between 3 and 6 characters.';
        return;
      }

      if (
        !admissionNumber ||
        !pin
      ) {
        message.textContent =
          'Please complete all fields.';
        return;
      }

      button.disabled = true;
      button.textContent =
        'Signing in...';

      try {
        const response =
          await fetch(
            `${API_BASE}/api/auth/student/login`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body: JSON.stringify({
                schoolCode,
                admissionNumber,
                pin,
              }),
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Unable to sign in.'
          );
        }

        /*
         * Store the student session separately
         * from the staff/admin session.
         */
        localStorage.setItem(
          STUDENT_TOKEN_KEY,
          data.token
        );

        localStorage.setItem(
          STUDENT_DATA_KEY,
          JSON.stringify(
            data.student
          )
        );

        window.location.href =
          '/roles/student/student-dashboard.html';

      } catch (error) {
        console.error(
          'Student sign-in error:',
          error
        );

        message.textContent =
          error.message ||
          'Unable to sign in. Please try again.';

      } finally {
        button.disabled = false;
        button.textContent =
          'Sign in';
      }
    }
  );
})();
