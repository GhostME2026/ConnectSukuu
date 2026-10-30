/* ConnectSukuu Teacher navigation state.
   Runs once after the role shell has been built; no permanent DOM observer. */
(function () {
  'use strict';

  function currentPage() {
    return (window.location.pathname.split('/').pop() || '').split('?')[0].toLowerCase();
  }

  function applyTeacherNavigationState() {
    var current = currentPage();
    var links = document.querySelectorAll(
      '.csk-teacher-sidebar-final a[href], .csk-teacher-nav-final a[href], ' +
      '.csk-teacher-nav a[href], .csk-teacher-sidebar a[href]'
    );

    links.forEach(function (link) {
      var target = (link.getAttribute('href') || '').split('/').pop().split('?')[0].toLowerCase();
      var active = Boolean(target && target === current);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    // Only use a meaningful page title. Generic document titles must not
    // overwrite a page heading that the page itself has already supplied.
    var title = (document.title || '').split('|')[0].trim();
    if (!title || /^(connectsukuu|teacher workspace)$/i.test(title)) return;
    var heading = document.querySelector(
      '.csk-teacher-header-title-final, .csk-teacher-title, .csk-teacher-topbar h1'
    );
    if (heading && heading.textContent.trim() !== title) heading.textContent = title;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTeacherNavigationState, { once: true });
  } else {
    applyTeacherNavigationState();
  }

  window.addEventListener('pageshow', applyTeacherNavigationState);
})();
