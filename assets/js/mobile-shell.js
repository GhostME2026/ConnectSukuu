/* ConnectSukuu mobile navigation drawer - behaviour. Loaded with `defer`; styles live in mobile-shell.css.
   Adds a menu button + backdrop at <= 820px. Desktop layouts are untouched. */
(function () {
  'use strict';
  if (window.__csMobileShell) return;
  window.__csMobileShell = true;
  var root = document.documentElement;
  var SELF = document.currentScript;
  var SIDEBARS = '.sidebar,.app-sidebar,.cs-sidebar,.cs-hoa-final-sidebar,.csk-teacher-sidebar,.cs-assessment-sidebar,.ns-sidebar,.csk-ht-sidebar-final,.csk-teacher-sidebar-final';
  function init() {
    var replace = !!(SELF && SELF.hasAttribute('data-replace-menu'));
    var hasOwn = !replace && document.querySelector('.cs-mobile-menu,#student-mobile-menu,#parent-mobile-menu,#security-mobile-menu,[data-mobile-menu]');
    if (hasOwn) { root.classList.add('csm-off'); return; }
    if (replace) {
      var hide = document.createElement('style');
      hide.textContent = '@media (max-width:820px){.mobile-menu{display:none!important}}';
      document.head.appendChild(hide);
    }
    var base = document.createElement('style');
    base.textContent = '@media (min-width:821px){.csm-toggle,.csm-backdrop{display:none!important}}';
    document.head.appendChild(base);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'csm-toggle';
    btn.setAttribute('aria-label', 'Open navigation');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '\u2630';
    var backdrop = document.createElement('div');
    backdrop.className = 'csm-backdrop';
    function lum(c) {
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
      if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return null;
      var v = [m[1], m[2], m[3]].map(function (x) { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    }
    function fixContrast(a) {
      var link = a.querySelector('a[href]');
      if (!link || a.classList.contains('csm-fixcolor')) return;
      var bg = null, e = a;
      while (e && bg === null) { bg = lum(getComputedStyle(e).backgroundColor); e = e.parentElement; }
      var fg = lum(getComputedStyle(link).color);
      if (bg === null || fg === null) return;
      var hi = Math.max(bg, fg) + 0.05, lo = Math.min(bg, fg) + 0.05;
      if (hi / lo < 3) a.classList.add('csm-fixcolor');
    }
    function mark() {
      var all = Array.prototype.slice.call(document.querySelectorAll(SIDEBARS))
        .filter(function (a) { return a.querySelectorAll('a[href]').length >= 3; });
      // When a page script rebuilds its sidebar, the old one is left hidden: keep only rendered ones.
      var shown = all.filter(function (a) { return a.getClientRects().length > 0; });
      var keep = shown.length ? shown : all.slice(0, 1);
      all.forEach(function (a) { a.classList.toggle('csm-drawer', keep.indexOf(a) !== -1); });
      keep.forEach(fixContrast);
    }
    mark();
    window.addEventListener('load', mark);
    setTimeout(mark, 800);
    document.body.appendChild(backdrop);
    document.body.appendChild(btn);
    function set(open) {
      root.classList.toggle('csm-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function () { mark(); set(true); });
    backdrop.addEventListener('click', function () { set(false); });
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest(SIDEBARS) && e.target.closest('a,button')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    var mq = window.matchMedia('(max-width:820px)');
    var onChange = function () { if (!mq.matches) set(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
