/* ConnectSukuu signup: single submission handler. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const form = () => byId('signup-form');
  function showError(message) {
    const box = byId('signup-error');
    if (!box) { window.alert(message); return; }
    box.textContent = message;
    box.classList.add('show');
    box.setAttribute('role', 'alert');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    const box = byId('signup-error');
    if (box) { box.textContent = ''; box.classList.remove('show'); }
  }
  function passwordOK(value) {
    return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
  }
  async function submit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearError();
    if (window.location.protocol === 'file:') {
      showError('Please open ConnectSukuu through your frontend server at http://localhost:5500/signup. Do not open /auth/signup.html directly from the file manager.');
      return;
    }
    const currentForm = form();
    if (!currentForm) return;
    const button = currentForm.querySelector('button[type="submit"]');
    const password = byId('signup-password')?.value || '';
    const confirm = byId('signup-password-confirm')?.value || '';
    const passwordError = byId('password-error');
    const passwordWrap = byId('password-field-wrap');
    const matchMessage = byId('password-match-msg');
    if (!currentForm.checkValidity()) {
      currentForm.reportValidity();
      return;
    }
    if (!passwordOK(password)) {
      passwordError?.classList.add('show');
      passwordWrap?.classList.add('has-error');
      showError('Use at least 8 characters, including uppercase and lowercase letters, a number and a symbol.');
      byId('signup-password')?.focus();
      return;
    }
    passwordError?.classList.remove('show');
    passwordWrap?.classList.remove('has-error');
    if (password !== confirm) {
      if (matchMessage) { matchMessage.textContent = 'Passwords do not match.'; matchMessage.style.color = '#dc2626'; }
      showError('The passwords do not match. Please confirm your password.');
      byId('signup-password-confirm')?.focus();
      return;
    }
    const dialRaw = (byId('phone-code')?.value || '+233 Ghana').trim();
    const dialMatch = dialRaw.match(/\+?\d{1,4}/);
    const phoneLocal = (byId('signup-phone')?.value || '').trim();
    const payload = {
      schoolName: (byId('school-name')?.value || '').trim(),
      firstName: (byId('first-name')?.value || '').trim(),
      lastName: (byId('last-name')?.value || '').trim(),
      email: (byId('signup-email')?.value || '').trim(),
      phone: `${dialMatch ? (dialMatch[0].startsWith('+') ? dialMatch[0] : '+' + dialMatch[0]) : '+233'} ${phoneLocal}`.trim(),
      password
    };
    const missing = ['schoolName','firstName','lastName','email'].filter(key => !payload[key]);
    if (missing.length) { showError('Please complete your name, email address and school name.'); return; }
    if (button) { button.disabled = true; button.textContent = 'Creating your account…'; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const base = String((typeof API_BASE !== 'undefined' && API_BASE) || window.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
      const response = await fetch(base + '/api/auth/signup-school', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
      if (!response.ok) throw new Error(data.error || `Account creation failed (HTTP ${response.status}).`);
      if (!data.token || !data.user) throw new Error('The API created a response without a login session. Check the backend signup response before retrying.');
      if (window.AUTH && typeof window.AUTH.setSession === 'function') window.AUTH.setSession(data.token, data.user);
      else { localStorage.setItem('cs_token', data.token); localStorage.setItem('cs_user', JSON.stringify(data.user)); }
      currentForm.style.display = 'none';
      const switchLine = byId('signup-switch-line'); if (switchLine) switchLine.style.display = 'none';
      const success = byId('success-panel'); if (success) success.style.display = 'block';
      const link = success?.querySelector('a'); if (link) link.href = '/roles/owner/owner-dashboard.html';
      success?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'The signup request timed out. Check that the backend is running on port 4000, then try again.'
        : (error instanceof TypeError
          ? 'Could not reach the signup API. Confirm the backend is running and that /assets/js/config.js points to http://localhost:4000. If this page is open as file://, reopen it through localhost:5500.'
          : (error.message || 'Could not create your account. Please try again.'));
      showError(message);
    } finally {
      window.clearTimeout(timer);
      if (button && (!byId('success-panel') || getComputedStyle(byId('success-panel')).display === 'none')) {
        button.disabled = false; button.textContent = 'Create school account';
      }
    }
  }
  function init() {
    const currentForm = form();
    if (!currentForm || currentForm.dataset.csSignupBound === '1') return;
    currentForm.dataset.csSignupBound = '1';
    currentForm.addEventListener('submit', submit, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
