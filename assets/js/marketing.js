document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav toggle
  const toggle = document.querySelector('.m-mobile-toggle');
  const nav = document.querySelector('.m-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      nav.classList.toggle('m-open');
      toggle.setAttribute('aria-expanded', String(nav.classList.contains('m-open')));
    });
  }

  // Animate mockup bar chart heights on load
  document.querySelectorAll('.bar-chart .bar').forEach((bar) => {
    const target = bar.dataset.height || '40%';
    bar.style.height = '4px';
    requestAnimationFrame(() => {
      bar.style.transition = 'height 0.8s cubic-bezier(.2,.8,.2,1)';
      setTimeout(() => { bar.style.height = target; }, 60);
    });
  });

  // Count-up numbers
  const counters = document.querySelectorAll('[data-count-to]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  counters.forEach((el) => {
    const target = parseFloat(el.dataset.countTo);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    if (reduceMotion) {
      el.textContent = prefix + target + suffix;
      return;
    }
    const duration = 1100;
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(target * eased);
      el.textContent = prefix + val + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  // Pricing billing toggle — generic across any number of modes (monthly/yearly/onetime/...)
  const billingBtns = document.querySelectorAll('.billing-toggle button');
  const priceEls = document.querySelectorAll('[data-monthly]');
  billingBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      billingBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      priceEls.forEach((el) => { el.textContent = el.dataset[mode] || el.dataset.monthly; });
    });
  });

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
});

// Password show/hide toggles — works for any .password-field on the page
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-field').querySelector('input');
      const showing = btn.classList.toggle('showing');
      input.type = showing ? 'text' : 'password';
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    });
  });

  // Simple confirm-password match check on signup
  const pw = document.getElementById('signup-password');
  const pw2 = document.getElementById('signup-password-confirm');
  const matchMsg = document.getElementById('password-match-msg');
  if (pw && pw2 && matchMsg) {
    const check = () => {
      if (!pw2.value) { matchMsg.textContent = ''; return; }
      matchMsg.textContent = pw.value === pw2.value ? 'Passwords match.' : 'Passwords do not match.';
      matchMsg.style.color = pw.value === pw2.value ? 'var(--green)' : '#dc2626';
    };
    pw.addEventListener('input', check);
    pw2.addEventListener('input', check);
  }
});

// ---------- Sign-up page: country list, password strength, submit handling ----------
document.addEventListener('DOMContentLoaded', () => {
  // Populate the searchable country datalist (COUNTRIES comes from /assets/js/countries.js)
  const countryList = document.getElementById('country-list');
  if (countryList && typeof COUNTRIES !== 'undefined') {
    COUNTRIES.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      countryList.appendChild(opt);
    });
  }

  // Searchable phone dial-code field (/assets/js/dial-codes.js)
  const dialCodeList = document.getElementById('dial-code-list');
  if (dialCodeList && typeof DIAL_CODES !== 'undefined') {
    DIAL_CODES.forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry;
      dialCodeList.appendChild(opt);
    });
  }

  // Region field mirrors the Country field's searchable behaviour: when the
  // selected country has a known state/province list (/assets/js/states.js), the
  // datalist fills with those. For any country we don't have data for, it
  // stays free text — nothing blocks typing a custom value either way.
  const countryInput = document.getElementById('country');
  const regionList = document.getElementById('region-list');
  const regionInput = document.getElementById('region');
  if (countryInput && regionList && typeof STATES_BY_COUNTRY !== 'undefined') {
    countryInput.addEventListener('input', () => {
      const states = STATES_BY_COUNTRY[countryInput.value.trim()];
      regionList.innerHTML = '';
      if (states) {
        states.forEach((name) => {
          const opt = document.createElement('option');
          opt.value = name;
          regionList.appendChild(opt);
        });
        regionInput.placeholder = 'Start typing…';
      } else {
        regionInput.placeholder = 'Type your state, region or province';
      }
    });
    countryInput.dispatchEvent(new Event('input')); // populate regions for the default country on load
  }


});

// ---------- Sign-in page: real login call ----------
document.addEventListener('DOMContentLoaded', () => {
  const signinForm = document.getElementById('signin-form');
  if (!signinForm) return;

  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errorBanner = document.getElementById('signin-error');
    errorBanner.classList.remove('show');

    const submitBtn = signinForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const identifier = document.getElementById('email').value.trim();
    
    const payload = {
      password: document.getElementById('password').value,
    };
    
    // Determines whether the user used an email addr or phone #.
    if (identifier.includes('@')) {
      payload.email = identifier;
    } else {
      payload.phone = identifier;
    }

    try {
      const base = typeof API_BASE !== 'undefined' ? API_BASE : 'http://localhost:4000';
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        errorBanner.textContent = data.error || 'Invalid email or password.';
        errorBanner.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
        return;
      }

      if (typeof AUTH !== 'undefined') AUTH.setSession(data.token, data.user);
      window.location.href = 'app-dashboard.html';
    } catch (err) {
      errorBanner.textContent = 'Could not reach the server — is the API running and is /assets/js/config.js pointing at the right URL?';
      errorBanner.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  });
});
