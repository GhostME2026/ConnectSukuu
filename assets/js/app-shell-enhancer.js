
/* CONNECTSUKUU_APP_SHELL_V1
 * Shared visual/interaction layer for every authenticated school app page.
 * Keeps page-specific functionality intact while standardising the application shell.
 */
(function connectSukuuShell() {
  const role = (() => {
    try { return JSON.parse(localStorage.getItem('cs_user') || 'null')?.role || ''; }
    catch { return ''; }
  })();

  const navRules = {
    'app-dashboard.html': ['OWNER','HEAD_TEACHER','ADMINISTRATOR','HEAD_OF_ACADEMICS','ACCOUNTANT','TEACHER','NURSE','SECURITY'],
    'app-team.html': ['OWNER','HEAD_TEACHER'],
    'app-academic.html': ['HEAD_TEACHER','ADMINISTRATOR','HEAD_OF_ACADEMICS','ACCOUNTANT','TEACHER'],
    'app-students.html': ['OWNER','HEAD_TEACHER','ADMINISTRATOR','HEAD_OF_ACADEMICS'],
    'app-attendance.html': ['HEAD_TEACHER','HEAD_OF_ACADEMICS','TEACHER','ADMINISTRATOR'],
    'app-teaching-assignments.html': ['HEAD_TEACHER','HEAD_OF_ACADEMICS','TEACHER'],
    'app-timetable.html': ['HEAD_TEACHER','HEAD_OF_ACADEMICS','TEACHER'],
    'app-finance.html': ['OWNER','HEAD_TEACHER','ACCOUNTANT','ADMINISTRATOR'],
    'app-settings.html': ['OWNER']
  };

  function injectStyles() {
    if (document.getElementById('connectsukuu-shell-style')) return;
    const style = document.createElement('style');
    style.id = 'connectsukuu-shell-style';
    style.textContent = `
      :root{--cs-blue:#2563eb;--cs-blue-2:#3b82f6;--cs-navy:#0f172a;--cs-navy-2:#111827;--cs-line:#e6eaf1}
      .app-sidebar,.sidebar{background:linear-gradient(180deg,#0f172a 0%,#111827 58%,#0b1220 100%)!important;color:#cbd5e1!important;border-right:1px solid rgba(255,255,255,.06)!important;box-shadow:12px 0 35px rgba(15,23,42,.06)}
      .app-sidebar .brand,.sidebar .brand{color:#fff!important;text-decoration:none!important}
      .app-sidebar .brand img,.sidebar .brand img{width:34px;height:34px}
      .app-sidebar .brand-mark,.sidebar .brand-mark{background:#2563eb!important;color:#fff!important;box-shadow:0 8px 20px rgba(37,99,235,.3)}
      .app-nav a,.nav a{position:relative;transition:transform .18s ease,background .18s ease,color .18s ease,box-shadow .18s ease!important}
      .app-nav a:hover,.nav a:hover{transform:translateX(3px);background:rgba(59,130,246,.12)!important;color:#fff!important}
      .app-nav a.active,.nav a.active{background:linear-gradient(90deg,#2563eb,#3b82f6)!important;color:#fff!important;box-shadow:0 8px 22px rgba(37,99,235,.22)}
      .app-nav a.active:before,.nav a.active:before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:0 4px 4px 0;background:#fff}
      .app-sidebar-footer .logout,.sidebar-bottom .logout,.academic-sidebar-footer .logout-btn{background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.12)!important;color:#fff!important;transition:all .2s ease!important}
      .app-sidebar-footer .logout:hover,.sidebar-bottom .logout:hover,.academic-sidebar-footer .logout-btn:hover{background:#1e293b!important;border-color:rgba(59,130,246,.45)!important;transform:translateY(-1px)}
      .app-main,.main{background:#f6f8fc!important}
      .app-topbar,.topbar{backdrop-filter:blur(12px);background:rgba(255,255,255,.9)!important}
      .app-stat,.card,.card-panel,.panel,.stat{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
      .app-stat:hover,.card:hover,.card-panel:hover,.panel:hover,.stat:hover{transform:translateY(-2px);box-shadow:0 14px 35px rgba(15,23,42,.07)}
      button,.btn{transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
      button:hover:not(:disabled),.btn:hover:not(:disabled){transform:translateY(-1px)}
      button:active:not(:disabled),.btn:active:not(:disabled){transform:translateY(0)}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  function normaliseNav() {
    const links = Array.from(document.querySelectorAll('.app-nav a,.nav a'));
    links.forEach(a => {
      const href = (a.getAttribute('href') || '').split('/').pop().split('?')[0];
      const allowed = navRules[href];
      if (allowed && role && !allowed.includes(role)) {
        a.style.display = 'none';
      }
      if (allowed && href === 'app-academic.html' && role === 'OWNER') {
        a.style.display = 'none';
      }
    });
  }

  function enhance() {
    injectStyles();
    normaliseNav();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance);
  else enhance();
})();
