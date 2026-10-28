const AUTH = {
  getToken() {
    return localStorage.getItem('cs_token');
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('cs_user') || 'null');
    } catch {
      return null;
    }
  },

  setSession(token, user) {
    localStorage.setItem('cs_token', token);
    localStorage.setItem('cs_user', JSON.stringify(user));
  },

  clearSession() {
    // Clear both current and legacy keys so a stale legacy user cannot
    // redirect signin back into an authenticated page without a token.
    ['cs_token', 'cs_user', 'connectsukuu_token', 'connectsukuu_user'].forEach((key) => {
      localStorage.removeItem(key);
    });
  },

  logout() {
    AUTH.clearSession();
    window.location.href = '/auth/signin.html';
  },
};

function requireAuthOrRedirect() {
  if (!AUTH.getToken()) {
    window.location.href = '/auth/signin.html';
    return null;
  }

  return AUTH.getUser();
}

async function apiFetch(path, options = {}) {
  const token = AUTH.getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    AUTH.logout();
    return null;
  }

  return res;
}

/**
 * Apply role-based visibility to navigation elements.
 *
 * Example:
 * data-role-nav="OWNER,HEAD_TEACHER"
 */
function applyNavigationRoleVisibility() {
  const user = AUTH.getUser();
  const role = user?.role || '';

  document.querySelectorAll('[data-role-nav]').forEach((element) => {
    const allowedRoles = (element.dataset.roleNav || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowedRoles.length) {
      element.hidden = false;
      return;
    }

    element.hidden = !allowedRoles.includes(role);
  });
}

/**
 * Initialize the shared ConnectSukuu application chrome.
 *
 * This intentionally supports the slightly different shells that already
 * exist in Academic Setup, Teaching Assignments and Timetable without
 * requiring us to rewrite their working page content.
 */
/* CONNECTSUKUU_STABLE_ROLE_CHROME_BASELINE */
function renderAppChrome(activePage) {
  const cachedUser = AUTH.getUser() || {};
  const whoEl = document.getElementById('app-who');
  const avatarEl = document.getElementById('app-avatar');

  function displayUser(user) {
    const safeUser = user || {};
    const fullName = `${safeUser.firstName || ''} ${safeUser.lastName || ''}`.trim();
    const email = safeUser.email || '';
    const label = fullName || email || 'User';
    const initial = (safeUser.firstName || email || 'U').charAt(0).toUpperCase();

    if (whoEl) whoEl.textContent = label;
    if (avatarEl) avatarEl.textContent = initial;
  }

  displayUser(cachedUser);

  if (!cachedUser.email && AUTH.getToken()) {
    (async function recoverProfile() {
      try {
        const token = AUTH.getToken();
        const parts = String(token).split('.');
        let claims = {};

        if (parts.length === 3) {
          const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
          claims = JSON.parse(decodeURIComponent(
            Array.prototype.map.call(
              atob(padded),
              ch => '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2)
            ).join('')
          ));
        }

        const candidateId = claims.id || claims.userId || claims.sub || null;
        const candidateEmail = claims.email || null;

        const response = await fetch(`${API_BASE}/api/staff`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) return;

        const payload = await response.json();
        const staff = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload.staff) ? payload.staff
          : (Array.isArray(payload.users) ? payload.users : []));

        const resolved = staff.find(person =>
          (candidateId && String(person.id) === String(candidateId)) ||
          (candidateEmail && String(person.email || '').toLowerCase() === String(candidateEmail).toLowerCase())
        );

        if (resolved) {
          AUTH.setSession(token, resolved);
          displayUser(resolved);
        }
      } catch (error) {
        console.warn('ConnectSukuu profile display recovery skipped:', error);
      }
    })();
  }

  document.querySelectorAll('.app-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === activePage);
  });

  const logoutBtn = document.getElementById('app-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', AUTH.logout);
}

/**
 * Small helper for pages that want to initialize the common application
 * shell without duplicating authentication logic.
 */
function initAppPage(activePage) {
  const user = requireAuthOrRedirect();

  if (!user) {
    return null;
  }

  renderAppChrome(activePage);
  return user;
}



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
    'app-settings.html': ['OWNER','HEAD_TEACHER']
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


/* CONNECTSUKUU_HEAD_TEACHER_STABLE_NAVIGATION */
(function(){
  'use strict';

  var ICONS={
    dashboard:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    team:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    academic:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 12 3l9 3.5L12 10 3 6.5Z"/><path d="M6 9v5.5c2 1.8 4 2.5 6 2.5s4-.7 6-2.5V9"/><path d="M21 7v7"/></svg>',
    students:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2.5 21c.5-4 2.7-6 6.5-6s6 2 6.5 6"/><path d="M16 11a3.5 3.5 0 1 0 0-7M18 15c2.1.4 3.4 2.2 3.8 5"/></svg>',
    attendance:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/></svg>',
    teaching:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>',
    timetable:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M8 13h3M13 13h3M8 17h3"/></svg>',
    assessment:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h5"/><path d="m15 18 1.5 1.5L20 16"/></svg>',
    finance:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="M3 21h20"/></svg>',
    settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M3 13v-2l2.2-.7.8-1.9L5 6.3l1.4-1.4 2.1 1 1.9-.8L11 3h2l.7 2.1 1.9.8 2.1-1L19 6.3l-1 2.1.8 1.9L21 11v2l-2.2.7-.8 1.9 1 2.1-1.4 1.4-2.1-1-1.9.8L13 21h-2l-.7-2.1-1.9-.8-2.1 1L5 17.7l1-2.1-.8-1.9L3 13Z"/></svg>'
  };

  var ITEMS=[
    ['dashboard','Dashboard','app-dashboard.html','Workspace'],
    ['team','Team & Roles','app-team.html','Workspace'],
    ['academic','Academic Setup','app-academic.html','Workspace'],
    ['students','Students','app-students.html','Workspace'],
    ['attendance','Attendance','app-attendance.html','Workspace'],
    ['teaching','Teaching Assignments','app-teaching-assignments.html','Teaching'],
    ['timetable','Timetable','app-timetable.html','Teaching'],
    ['assessment','Assessments & Reports','app-assessments.html','Teaching'],
    ['finance','Finance','app-finance.html','Finance'],
    ['settings','Settings','app-settings.html','System']
  ];

  function getUser(){
    try{
      if(typeof requireAuthOrRedirect==='function')return requireAuthOrRedirect();
    }catch(e){}
    try{
      return JSON.parse(localStorage.getItem('connectsukuu_user')||'null');
    }catch(e){return null;}
  }

  function install(){
    var user=getUser();
    if(!user||user.role!=='HEAD_TEACHER')return;

    var sidebar=document.querySelector('.sidebar');
    if(!sidebar)return;
    var nav=sidebar.querySelector('.nav');
    if(!nav)return;

    var current=(location.pathname.split('/').pop()||'app-dashboard.html').toLowerCase();

    nav.innerHTML=
      '<div class="section-label nav-section">Workspace</div>'+
      ITEMS.filter(function(x){return x[3]==='Workspace';}).map(link).join('')+
      '<div class="section-label nav-section">Teaching</div>'+
      ITEMS.filter(function(x){return x[3]==='Teaching';}).map(link).join('')+
      '<div class="section-label nav-section">Finance</div>'+
      link(ITEMS.find(function(x){return x[0]==='finance';}))+
      '<div class="section-label nav-section">System</div>'+
      link(ITEMS.find(function(x){return x[0]==='settings';}));

    function link(x){
      return '<a href="'+x[2]+'" data-page="'+x[0]+'" class="'+(x[2].toLowerCase()===current?'active':'')+'">'+
        '<span class="nav-icon">'+ICONS[x[0]]+'</span><span>'+x[1]+'</span></a>';
    }

    if(!document.getElementById('cs-headteacher-nav-style')){
      var style=document.createElement('style');
      style.id='cs-headteacher-nav-style';
      style.textContent=
        '.nav a{display:flex!important;align-items:center!important;gap:10px!important}'+
        '.nav a .nav-icon{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px}'+
        '.nav a .nav-icon svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'+
        '.nav-section{margin-top:18px!important}';
      document.head.appendChild(style);
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();




/* CONNECTSUKUU_HEAD_TEACHER_STABLE_NAVIGATION_FINAL */
(function(){
  'use strict';
  var original=window.renderAppChrome;
  if(typeof original!=='function')return;
  var items=[
    ['WORKSPACE',[
      ['app-dashboard.html','▦','Dashboard'],
      ['app-team.html','♟','Team & Roles'],
      ['app-academic.html','▤','Academic Setup'],
      ['app-students.html','♙','Students'],
      ['app-attendance.html','✓','Attendance']]],
    ['TEACHING',[
      ['app-teaching-assignments.html','⇄','Teaching Assignments'],
      ['app-timetable.html','▦','Timetable'],
      ['app-assessments.html','▣','Assessments & Reports']]],
    ['FINANCE',[
      ['app-finance.html','₵','Finance']]],
    ['SYSTEM',[
      ['app-settings.html','⚙','Settings']]]
  ];
  function stableMenu(){
    var user=null;
    try{user=typeof requireAuthOrRedirect==='function'?requireAuthOrRedirect():null;}catch(e){return;}
    if(!user||user.role!=='HEAD_TEACHER')return;
    var nav=document.querySelector('.app-sidebar nav,.sidebar nav,nav.nav,.app-nav');
    if(!nav)return;
    var current=(location.pathname.split('/').pop()||'app-dashboard.html').toLowerCase();
    nav.innerHTML=items.map(function(section){
      return '<div class="nav-section">'+section[0]+'</div>'+
        section[1].map(function(item){
          return '<a href="'+item[0]+'" data-cs-headteacher-nav="1"'+
            (current===item[0].toLowerCase()?' class="active"':'')+'>'+
            '<span aria-hidden="true" style="display:inline-flex;width:18px;justify-content:center;font-weight:800">'+item[1]+'</span>'+item[2]+'</a>';
        }).join('');
    }).join('');
  }
  window.renderAppChrome=function(){
    var result=original.apply(this,arguments);setTimeout(stableMenu,0);return result;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',stableMenu);
  else setTimeout(stableMenu,0);
})();
 /* END_CONNECTSUKUU_HEAD_TEACHER_STABLE_NAVIGATION_FINAL */







/* CONNECTSUKUU_CANONICAL_SHELL_LAYOUT_REPAIR */
(function(){
  'use strict';

  function injectStyle(){
    if(document.getElementById('connectsukuu-canonical-shell-layout-style')) return;
    var style=document.createElement('style');
    style.id='connectsukuu-canonical-shell-layout-style';
    style.textContent = [
      '.cs-canonical-role-sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:224px!important;height:100vh!important;min-height:100vh!important;max-height:100vh!important;overflow-y:auto!important;overflow-x:hidden!important;z-index:1000!important}',
      '.cs-canonical-role-sidebar + .main,.cs-canonical-role-sidebar ~ .main{margin-left:224px!important;width:calc(100% - 224px)!important;max-width:none!important;min-height:100vh!important;box-sizing:border-box!important}',
      '.cs-canonical-role-sidebar ~ .app-main{margin-left:224px!important;width:calc(100% - 224px)!important;max-width:none!important;min-height:100vh!important;box-sizing:border-box!important}',
      '.app-shell:has(.cs-canonical-role-sidebar),.layout:has(.cs-canonical-role-sidebar),.app:has(.cs-canonical-role-sidebar){min-height:100vh!important;width:100%!important}',
      '.cs-canonical-role-header{position:sticky!important;top:0!important;z-index:900!important;min-height:64px!important;box-sizing:border-box!important;background:rgba(255,255,255,.96)!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;padding-right:228px!important}',
      '.cs-canonical-role-profile{position:absolute!important;top:12px!important;right:18px!important;margin:0!important;z-index:5!important;box-sizing:border-box!important;min-width:196px!important;max-width:280px!important;height:42px!important;padding:4px 9px!important;border:1px solid #e4eaf3!important;border-radius:13px!important;background:#fff!important;box-shadow:0 4px 14px rgba(15,23,42,.07)!important}',
      '.cs-canonical-role-profile .cs-canonical-role-avatar{width:34px!important;height:34px!important;border-radius:10px!important}',
      '.cs-canonical-role-profile .cs-canonical-role-copy{min-width:0!important;overflow:hidden!important}',
      '.cs-canonical-role-profile .cs-canonical-role-email,.cs-canonical-role-profile .cs-canonical-role-name{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}',
      '.cs-canonical-role-header .topbar-user{display:none!important}',
      '.cs-canonical-role-header .user-card,.cs-canonical-role-header .who{display:none!important}',
      '.app-main{max-width:none!important}',
      '.app-main > .app-content,.app-main .app-content{width:100%!important;max-width:none!important;box-sizing:border-box!important}',
      '.app-topbar{width:100%!important;box-sizing:border-box!important}',
      '.main > .content,.main > section.content{width:100%!important;max-width:none!important;box-sizing:border-box!important}',
      '.cs-canonical-role-sidebar::-webkit-scrollbar{width:7px!important}',
      '.cs-canonical-role-sidebar::-webkit-scrollbar-thumb{background:rgba(148,163,184,.35)!important;border-radius:999px!important}',
      '@media(min-width:821px){.cs-canonical-role-header{padding-left:24px!important}.app-topbar{padding-left:24px!important;padding-right:228px!important}}',
      '@media(max-width:820px){.cs-canonical-role-sidebar{width:200px!important}.cs-canonical-role-sidebar + .main,.cs-canonical-role-sidebar ~ .main{margin-left:200px!important;width:calc(100% - 200px)!important}.cs-canonical-role-sidebar ~ .app-main{margin-left:200px!important;width:calc(100% - 200px)!important}.cs-canonical-role-profile{right:14px!important;min-width:0!important;width:44px!important}.cs-canonical-role-profile .cs-canonical-role-copy{display:none!important}}',
      '@media(max-width:620px){.cs-canonical-role-sidebar{position:static!important;width:100%!important;height:auto!important;min-height:auto!important;max-height:none!important;overflow:visible!important}.cs-canonical-role-sidebar + .main,.cs-canonical-role-sidebar ~ .main,.cs-canonical-role-sidebar ~ .app-main{margin-left:0!important;width:100%!important}.cs-canonical-role-header{position:sticky!important;top:0!important;padding-right:72px!important}.cs-canonical-role-profile{top:9px!important;right:12px!important}.app-shell,.layout,.app{display:block!important}}'
    ].join('');
    document.head.appendChild(style);
  }

  function normalizeHeaders(){
    document.querySelectorAll('.app-topbar,header.topbar,.topbar').forEach(function(header){
      header.classList.add('cs-canonical-role-header');
      /* Remove the old Academic Setup U / User widget. */
      header.querySelectorAll('.topbar-user').forEach(function(el){el.remove();});
      /* The canonical profile is the only profile shown in the header. */
      header.querySelectorAll('.who,.user-card').forEach(function(el){
        if(el.id!=='cs-canonical-role-profile') el.style.display='none';
      });
    });
  }

  function normalizeShell(){
    var side=document.querySelector('.cs-canonical-role-sidebar');
    if(!side) return;
    var main=document.querySelector('.app-main') || document.querySelector('.main');
    if(main){main.style.maxWidth='none';main.style.boxSizing='border-box';}
    var shell=document.querySelector('.app-shell,.layout,.app');
    if(shell){shell.style.minHeight='100vh';shell.style.width='100%';}
  }

  function run(){injectStyle();normalizeHeaders();normalizeShell();}
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){run();setTimeout(run,50);setTimeout(run,300);setTimeout(run,1000);});
  }else{
    run();setTimeout(run,50);setTimeout(run,300);setTimeout(run,1000);
  }
  window.connectSukuuCanonicalShellLayoutRepair=run;
})();


/* CONNECTSUKUU_STABLE_NON_HT_ROLE_CHROME */
(function () {
  'use strict';

  /*
   * Scoped deliberately to OWNER, HEAD_OF_ACADEMICS and TEACHER.
   * HEAD_TEACHER is never modified by this installer.
   */
  var ROLE_LABELS = {
    OWNER: 'Owner',
    HEAD_OF_ACADEMICS: 'Head of Academics',
    TEACHER: 'Teacher'
  };

  var MENUS = {
    OWNER: [
      ['Workspace', [
        ['Dashboard', 'app-dashboard.html'],
        ['Team & Roles', 'app-team.html']
      ]],
      ['Finance', [
        ['Finance', 'app-finance.html']
      ]],
      ['System', [
        ['Settings', 'app-settings.html']
      ]]
    ],

    HEAD_OF_ACADEMICS: [
      ['Workspace', [
        ['Dashboard', 'app-dashboard.html'],
        ['Academic Setup', 'app-academic.html'],
        ['Students', 'app-students.html'],
        ['Attendance', 'app-attendance.html']
      ]],
      ['Teaching', [
        ['Teaching Assignments', 'app-teaching-assignments.html'],
        ['Timetable', 'app-timetable.html'],
        ['Assessments & Reports', 'app-assessments.html']
      ]]
    ],

    TEACHER: [
      ['Workspace', [
        ['Dashboard', 'app-dashboard.html'],
        ['Attendance', 'app-attendance.html']
      ]],
      ['Teaching', [
        ['Teaching Assignments', 'app-teaching-assignments.html'],
        ['Timetable', 'app-timetable.html'],
        ['Assessments & Reports', 'app-assessments.html']
      ]]
    ]
  };

  var ICONS = {
    'Dashboard':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>',
    'Team & Roles':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    'Academic Setup':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V5.8A2.8 2.8 0 0 1 6.8 3H20v16H6.8A2.8 2.8 0 0 0 4 21.8"></path><path d="M4 19.5A2.8 2.8 0 0 1 6.8 16H20"></path></svg>',
    'Students':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4"></circle><path d="M2.5 21a6.5 6.5 0 0 1 13 0"></path><path d="M17 11a4 4 0 0 1 4 4M17 17h4"></path></svg>',
    'Attendance':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg>',
    'Teaching Assignments':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="M8 9h8M8 13h6M8 17h4"></path></svg>',
    'Timetable':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M8 4v5M16 4v5M7 13h3M14 13h3M7 16h3"></path></svg>',
    'Assessments & Reports':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"></path><path d="M8 8h8M8 12h8M8 16h5"></path></svg>',
    'Finance':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18M8 15h4"></path></svg>',
    'Settings':
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M5.9 5.9l1.4 1.4M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4"></path><circle cx="12" cy="12" r="4"></circle></svg>'
  };

  var running = false;

  function getUser() {
    try {
      var raw = localStorage.getItem('cs_user');
      if (raw) {
        var u = JSON.parse(raw);
        if (u && u.role) return u;
      }
    } catch (e) {}
    try {
      var raw2 = localStorage.getItem('connectsukuu_user');
      if (raw2) {
        var u2 = JSON.parse(raw2);
        if (u2 && u2.role) return u2;
      }
    } catch (e2) {}
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[c];
    });
  }

  function currentFile() {
    return (location.pathname.split('/').pop() || 'app-dashboard.html').toLowerCase();
  }

  function sidebar() {
    return document.querySelector('.app-sidebar') ||
           document.querySelector('aside.sidebar') ||
           document.querySelector('.sidebar');
  }

  function navRoot(side) {
    if (!side) return null;
    return side.querySelector('.app-nav') ||
           side.querySelector('nav') ||
           side.querySelector('.navigation') ||
           side;
  }

  function topbar() {
    return document.querySelector('.app-topbar') ||
           document.querySelector('header.topbar') ||
           document.querySelector('.topbar');
  }

  function installStyle() {
    if (document.getElementById('cs-stable-role-chrome-style')) return;

    var style = document.createElement('style');
    style.id = 'cs-stable-role-chrome-style';
    style.textContent =
      '.cs-stable-role-sidebar{min-height:100vh!important;height:100vh!important;display:flex!important;flex-direction:column!important;box-sizing:border-box!important;overflow-y:auto!important}' +
      '.cs-stable-role-sidebar .app-sidebar-footer,.cs-stable-role-sidebar .sidebar-footer,.cs-stable-role-sidebar .sidebar-bottom{margin-top:auto!important;flex:0 0 auto!important}' +
      '.cs-stable-role-nav{display:flex!important;flex-direction:column!important;gap:6px!important;width:100%!important}' +
      '.cs-stable-role-section{margin:16px 10px 6px!important;font-size:10px!important;font-weight:800!important;letter-spacing:.11em!important;text-transform:uppercase!important;color:#8390a6!important}' +
      '.cs-stable-role-section:first-child{margin-top:2px!important}' +
      '.cs-stable-role-link{display:flex!important;align-items:center!important;gap:10px!important;min-height:40px!important;padding:10px 12px!important;border-radius:10px!important;text-decoration:none!important;color:#9aa8bd!important;font-size:13px!important;font-weight:700!important;transition:background .18s ease,color .18s ease,transform .18s ease!important}' +
      '.cs-stable-role-link:hover{background:rgba(37,99,235,.12)!important;color:#eaf2ff!important;transform:translateX(1px)!important}' +
      '.cs-stable-role-link.active{background:#2563eb!important;color:#fff!important;box-shadow:0 6px 16px rgba(37,99,235,.18)!important}' +
      '.cs-stable-role-icon{width:18px!important;height:18px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 18px!important}' +
      '.cs-stable-role-icon svg{width:17px!important;height:17px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}' +
      '.cs-stable-role-profile{display:flex!important;align-items:center!important;gap:10px!important;margin-left:auto!important;flex:0 0 auto!important;padding:7px 10px!important;border:1px solid #e4eaf3!important;border-radius:14px!important;background:#fff!important;box-shadow:0 3px 12px rgba(15,23,42,.05)!important;min-width:190px!important;max-width:300px!important}' +
      '.cs-stable-role-avatar{width:34px!important;height:34px!important;border-radius:10px!important;background:#172033!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:12px!important;font-weight:850!important;flex:0 0 34px!important}' +
      '.cs-stable-role-copy{min-width:0!important;line-height:1.15!important;overflow:hidden!important}' +
      '.cs-stable-role-email{font-size:12px!important;font-weight:800!important;color:#172033!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}' +
      '.cs-stable-role-name{font-size:10px!important;color:#98a2b3!important;margin-top:4px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}' +
      '.cs-stable-role-header .user,.cs-stable-role-header .who,.cs-stable-role-header .user-card,.cs-stable-role-header .topbar-user{display:none!important}' +
      '@media(max-width:680px){.cs-stable-role-profile{min-width:0!important;padding:6px!important}.cs-stable-role-copy{display:none!important}}';

    document.head.appendChild(style);
  }

  function installNav(user) {
    var side = sidebar();
    var root = navRoot(side);
    var groups = MENUS[user.role];

    if (!side || !root || !groups) return;

    var html = '';
    groups.forEach(function (group) {
      html += '<div class="cs-stable-role-section">' + esc(group[0]) + '</div>';
      group[1].forEach(function (item) {
        var active = currentFile() === item[1].toLowerCase();
        html += '<a class="cs-stable-role-link' + (active ? ' active' : '') +
          '" href="' + item[1] + '" data-cs-stable-role-link="1">' +
          '<span class="cs-stable-role-icon">' + (ICONS[item[0]] || '') + '</span>' +
          '<span>' + esc(item[0]) + '</span></a>';
      });
    });

    var existing = root.getAttribute('data-cs-stable-role-html') || '';
    if (existing !== html) {
      running = true;
      root.innerHTML = html;
      root.classList.add('cs-stable-role-nav');
      root.setAttribute('data-cs-stable-role-html', html);
      running = false;
    } else {
      root.classList.add('cs-stable-role-nav');
    }

    side.classList.add('cs-stable-role-sidebar');
  }

  function installProfile(user) {
    var head = topbar();
    if (!head) return;
    head.classList.add('cs-stable-role-header');

    var profile = document.getElementById('cs-stable-role-profile');

    if (!profile) {
      profile = document.createElement('div');
      profile.id = 'cs-stable-role-profile';
      profile.className = 'cs-stable-role-profile';
      profile.innerHTML =
        '<div class="cs-stable-role-avatar" id="cs-stable-role-avatar"></div>' +
        '<div class="cs-stable-role-copy">' +
          '<div class="cs-stable-role-email" id="cs-stable-role-email"></div>' +
          '<div class="cs-stable-role-name" id="cs-stable-role-name"></div>' +
        '</div>';
      head.appendChild(profile);
    }

    [
      '#cs-canonical-role-profile',
      '#cs-assessment-profile',
      '.cs-assessment-profile'
    ].forEach(function (selector) {
      head.querySelectorAll(selector).forEach(function (el) {
        if (el !== profile) el.style.display = 'none';
      });
    });

    profile.style.display = 'flex';

    var initial = String(user.firstName || user.email || '?').charAt(0).toUpperCase();
    var email = user.email || 'User';
    var role = ROLE_LABELS[user.role] || user.role || 'User';

    var avatar = document.getElementById('cs-stable-role-avatar');
    var emailEl = document.getElementById('cs-stable-role-email');
    var roleEl = document.getElementById('cs-stable-role-name');

    if (avatar) avatar.textContent = initial;
    if (emailEl) emailEl.textContent = email;
    if (roleEl) roleEl.textContent = role;
  }

  function install() {
    if (running) return;

    var user = getUser();
    if (!user || !user.role) return;

    /*
     * Critical preservation rule:
     * Head Teacher is the established stable reference and is not touched here.
     */
    if (user.role === 'HEAD_TEACHER') return;

    if (!MENUS[user.role]) return;

    installStyle();
    installNav(user);
    installProfile(user);
  }

  function start() {
    install();

    var observer = new MutationObserver(function () {
      if (running) return;
      window.clearTimeout(start._timer);
      start._timer = window.setTimeout(install, 20);
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.connectSukuuStableNonHtRoleChrome = install;
})();
/* END_CONNECTSUKUU_STABLE_NON_HT_ROLE_CHROME */

