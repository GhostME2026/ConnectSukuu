/* Teacher shell navigation state: match the current URL, independent of legacy nav markup. */
(function () {
  'use strict';
  function applyTeacherNavigationState() {
    var current = (location.pathname.split('/').pop() || '').toLowerCase();
    document.querySelectorAll('.csk-teacher-sidebar nav a[href], .csk-teacher-nav nav a[href], .csk-teacher-nav-final a[href], .csk-teacher-nav a[href], aside nav a[href]').forEach(function (link) {
      var target = (link.getAttribute('href') || '').split('/').pop().split('?')[0].toLowerCase();
      var active = !!target && target === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    var title = (document.title || '').split('|')[0].trim();
    if (title) {
      var heading = document.querySelector('.csk-teacher-header-title-final, .csk-teacher-title, .csk-teacher-topbar h1, header.topbar h1, header.app-topbar h1');
      if (heading) heading.textContent = title;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyTeacherNavigationState, { once: true });
  else applyTeacherNavigationState();
  // Some teacher pages build their final sidebar after DOMContentLoaded.
  var observer = new MutationObserver(function () { applyTeacherNavigationState(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pageshow', applyTeacherNavigationState);
})();
