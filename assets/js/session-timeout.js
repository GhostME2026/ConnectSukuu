/* ConnectSukuu — central inactivity session timeout
 * Policy: 30 minutes without activity; warn at 25 minutes.
 * Applies to authenticated role pages. Does not replace JWT validation.
 */
(function connectSukuuInactivityTimeout() {
  'use strict';

  var IDLE_LIMIT_MS = 30 * 60 * 1000;
  var WARNING_AT_MS = 25 * 60 * 1000;
  var ACTIVITY_WRITE_THROTTLE_MS = 10 * 1000;
  var LAST_ACTIVITY_KEY = 'cs_last_activity_at';
  var TOKEN_KEYS = ['cs_token', 'connectsukuu_token'];
  var USER_KEYS = ['cs_user', 'connectsukuu_user'];
  var timer = null;
  var countdownTimer = null;
  var lastActivity = 0;
  var lastWrite = 0;
  var overlay = null;
  var countdownNode = null;
  var warningVisible = false;
  var loggedOut = false;

  function getToken() {
    for (var i = 0; i < TOKEN_KEYS.length; i += 1) {
      var token = localStorage.getItem(TOKEN_KEYS[i]);
      if (token) return token;
    }
    return null;
  }

  // Public pages, sign-in, and sign-up must not start an idle session.
  if (!getToken()) return;
  document.documentElement.setAttribute('data-csk-idle-timeout', 'active');

  function signInUrl() {
    var path = window.location.pathname || '';
    var depth = path.split('/').filter(Boolean).length;
    // Role pages are /roles/{role}/{page}; Super Admin is /super-admin/admin.html.
    var prefix = path.indexOf('/super-admin/') !== -1 ? '../' : '../../';
    return prefix + 'auth/signin.html?reason=idle';
  }

  function clearSessionAndRedirect() {
    if (loggedOut) return;
    loggedOut = true;
    window.clearInterval(timer);
    window.clearInterval(countdownTimer);
    try {
      TOKEN_KEYS.concat(USER_KEYS, [LAST_ACTIVITY_KEY]).forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
      // Continue to the sign-in page even if browser storage is unavailable.
    }
    window.location.replace(signInUrl());
  }

  function ensureOverlay() {
    if (overlay) return;
    var style = document.createElement('style');
    style.id = 'cs-idle-timeout-style';
    style.textContent =
      '#cs-idle-timeout-overlay{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(5px)}' +
      '#cs-idle-timeout-dialog{width:min(440px,100%);padding:28px;border-radius:18px;background:#fff;color:#172033;box-shadow:0 24px 80px rgba(0,0,0,.25);font:inherit;text-align:left}' +
      '#cs-idle-timeout-dialog h2{margin:0 0 10px;font-size:21px;line-height:1.3;color:#0f172a}' +
      '#cs-idle-timeout-dialog p{margin:0 0 18px;color:#475569;line-height:1.55;font-size:14px}' +
      '#cs-idle-timeout-countdown{font-weight:700;color:#1d4ed8;font-variant-numeric:tabular-nums}' +
      '#cs-idle-timeout-stay{width:100%;border:0;border-radius:10px;padding:12px 16px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;cursor:pointer}' +
      '#cs-idle-timeout-stay:hover{background:#1d4ed8}' +
      '@media(prefers-reduced-motion:no-preference){#cs-idle-timeout-dialog{animation:csIdleIn .18s ease-out}@keyframes csIdleIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}}';
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'cs-idle-timeout-overlay';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML =
      '<section id="cs-idle-timeout-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cs-idle-timeout-title" aria-describedby="cs-idle-timeout-description">' +
        '<h2 id="cs-idle-timeout-title">Are you still there?</h2>' +
        '<p id="cs-idle-timeout-description">For your security, ConnectSukuu will sign you out after 30 minutes of inactivity. You will be signed out in <span id="cs-idle-timeout-countdown">05:00</span> unless you choose to stay signed in.</p>' +
        '<button id="cs-idle-timeout-stay" type="button">Stay signed in</button>' +
      '</section>';
    document.body.appendChild(overlay);
    countdownNode = document.getElementById('cs-idle-timeout-countdown');
    document.getElementById('cs-idle-timeout-stay').addEventListener('click', function () {
      recordActivity(true);
      hideWarning();
    });
  }

  function showWarning() {
    if (warningVisible || loggedOut) return;
    ensureOverlay();
    warningVisible = true;
    overlay.style.display = 'flex';
    if (countdownTimer) window.clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function hideWarning() {
    warningVisible = false;
    if (overlay) overlay.style.display = 'none';
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function updateCountdown() {
    var remaining = Math.max(0, IDLE_LIMIT_MS - (Date.now() - lastActivity));
    var seconds = Math.ceil(remaining / 1000);
    if (countdownNode) {
      var mins = String(Math.floor(seconds / 60)).padStart(2, '0');
      var secs = String(seconds % 60).padStart(2, '0');
      countdownNode.textContent = mins + ':' + secs;
    }
    if (remaining <= 0) clearSessionAndRedirect();
  }

  function recordActivity(forceWrite) {
    if (loggedOut) return;
    var now = Date.now();
    lastActivity = now;
    if (forceWrite || now - lastWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
        lastWrite = now;
      } catch (error) {
        // The in-tab timer still works if storage is blocked.
      }
    }
    hideWarning();
  }

  function checkIdleState() {
    if (loggedOut) return;
    var idleFor = Date.now() - lastActivity;
    if (idleFor >= IDLE_LIMIT_MS) {
      clearSessionAndRedirect();
    } else if (idleFor >= WARNING_AT_MS) {
      showWarning();
    } else if (warningVisible) {
      hideWarning();
    }
  }

  function onStorage(event) {
    if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
      var sharedActivity = Number(event.newValue);
      if (Number.isFinite(sharedActivity) && sharedActivity > lastActivity) {
        lastActivity = sharedActivity;
        hideWarning();
      }
    } else if (TOKEN_KEYS.indexOf(event.key) !== -1 && !event.newValue) {
      clearSessionAndRedirect();
    }
  }

  // Meaningful user interaction resets the inactivity clock.
  ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(function (eventName) {
    document.addEventListener(eventName, function () {
      recordActivity(false);
    }, { passive: true, capture: true });
  });

  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', checkIdleState);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkIdleState();
  });

  try {
    var storedActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    lastActivity = Number.isFinite(storedActivity) && storedActivity > 0 ? storedActivity : Date.now();
    if (!storedActivity) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity));
    }
  } catch (error) {
    lastActivity = Date.now();
  }

  // Re-check when the tab becomes active so sleeping/background tabs cannot
  // postpone the timeout beyond the configured 30-minute idle limit.
  checkIdleState();
  timer = window.setInterval(checkIdleState, 1000);
})();
