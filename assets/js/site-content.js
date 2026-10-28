/* ConnectSukuu public-site content renderer. Safe by design: content is inserted as text, never HTML. */
(function () {
  const apiBase = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : 'http://localhost:4000';
  const onReady = (fn) => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn();

  function setText(el, value) { if (el && typeof value === 'string') el.textContent = value; }
  function setBrand(el, prefix, accent) {
    if (!el) return;
    el.replaceChildren(document.createTextNode(prefix || 'Connect'));
    if (accent) {
      const span = document.createElement('span');
      span.className = 'accent';
      span.textContent = accent;
      el.appendChild(span);
    }
  }
  function setLogo(el, url) {
    if (!el || !url) return;
    const fallback = Array.from(el.childNodes).map(n => n.cloneNode(true));
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.loading = 'eager'; img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit';
    img.addEventListener('error', () => el.replaceChildren(...fallback), { once: true });
    el.replaceChildren(img);
  }
  function render(content) {
    if (!content || typeof content !== 'object') return;
    const root = document.documentElement;
    if (/^#[0-9a-f]{6}$/i.test(content.primaryColor || '')) root.style.setProperty('--blue', content.primaryColor);
    if (/^#[0-9a-f]{6}$/i.test(content.secondaryColor || '')) root.style.setProperty('--blue2', content.secondaryColor);

    document.querySelectorAll('.brand-word').forEach(el => setBrand(el, content.brandPrefix, content.brandAccent));
    if (content.logoUrl) document.querySelectorAll('.brand-mark').forEach(el => setLogo(el, content.logoUrl));
    document.querySelectorAll('.brand-blurb').forEach(el => setText(el, content.footerBlurb));
    document.querySelectorAll('.footer-base > span').forEach(el => setText(el, content.footerCopyright));

    // Update contact details in every public page footer, without relying on a single footer class variant.
    const contactHeadings = Array.from(document.querySelectorAll('footer h4, .m-footer h4'));
    const contactHeading = contactHeadings.find(el => /contact/i.test(el.textContent || ''));
    const contactCol = contactHeading?.closest('.footer-col');
    if (contactCol) {
      const ps = contactCol.querySelectorAll('p');
      setText(ps[0], content.contactLocation);
      setText(ps[1], content.contactEmail);
      setText(ps[2], content.contactPhone);
    }

    // Announcement visibility is managed on every public page.
    let banner = document.querySelector('[data-connectsukuu-announcement]');
    const announcementText = typeof content.announcementText === 'string' ? content.announcementText.trim() : '';
    if (content.announcementEnabled && announcementText) {
      if (!banner) {
        banner = document.createElement('div');
        banner.dataset.connectsukuuAnnouncement = 'true';
        banner.style.cssText = 'padding:10px 18px;text-align:center;color:#fff;font-weight:650;font-size:13px;line-height:1.5;background:var(--blue,#2563eb);position:relative;z-index:30';
        const header = document.querySelector('.m-header, header');
        if (header) header.before(banner); else document.body.prepend(banner);
      }
      setText(banner, announcementText);
      banner.hidden = false;
    } else if (banner) {
      banner.remove();
    }

    const path = location.pathname.split('/').pop() || '/index.html';
    if (path === '' || path === '/index.html') {
      const hero = document.querySelector('.hero-copy');
      if (hero) {
        setText(hero.querySelector('.eyebrow'), content.homeEyebrow);
        setText(hero.querySelector('h1'), content.homeTitle);
        const description = Array.from(hero.querySelectorAll('p')).find(el => !el.classList.contains('trust-line'));
        setText(description, content.homeDescription);
        setText(hero.querySelector('.hero-actions .btn-primary'), content.homePrimaryCta);
        setText(hero.querySelector('.hero-actions .btn-outline'), content.homeSecondaryCta);
        const wrap = document.querySelector('.mockup-wrap');
        if (wrap && content.heroImageUrl) {
          let img = wrap.querySelector('[data-site-hero-image]');
          if (!img) {
            img = document.createElement('img'); img.dataset.siteHeroImage = 'true';
            img.alt = 'ConnectSukuu platform preview';
            img.style.cssText = 'display:block;width:100%;max-width:640px;max-height:520px;object-fit:contain;border-radius:18px;box-shadow:0 24px 60px #0b15302b';
            wrap.appendChild(img);
          }
          img.src = content.heroImageUrl;
          const mockup = wrap.querySelector('.mockup');
          if (mockup) mockup.hidden = true;
          img.onerror = () => { img.remove(); if (mockup) mockup.hidden = false; };
        }
      }
    }

    // Page-specific marketing copy. Target the first visible page heading and its nearby intro text,
    // preserving all layout, links, pricing tables, forms and decorative markup.
    const pageCopy = {
      '/public-pages/features.html': ['featuresEyebrow', 'featuresTitle', 'featuresDescription'],
      '/public-pages/about.html': ['aboutEyebrow', 'aboutTitle', 'aboutDescription'],
      '/public-pages/pricing.html': ['pricingEyebrow', 'pricingTitle', 'pricingDescription'],
      '/public-pages/contact.html': ['contactEyebrow', 'contactTitle', 'contactDescription']
    };
    const copyKeys = pageCopy[path];
    if (copyKeys) {
      const h1 = document.querySelector('main h1, .hero h1, .page-hero h1, h1');
      const section = h1?.closest('section') || h1?.parentElement?.parentElement;
      const eyebrow = section?.querySelector('.eyebrow, .section-kicker, .kicker, .overline');
      const intro = section ? Array.from(section.querySelectorAll('p')).find(p => !p.classList.contains('trust-line')) : null;
      setText(eyebrow, content[copyKeys[0]]);
      setText(h1, content[copyKeys[1]]);
      setText(intro, content[copyKeys[2]]);
    }

    // Keep feature cards visually consistent across both public pages.
    if ((path === '' || path === '/index.html' || path === '/public-pages/features.html') && Array.isArray(content.features)) {
      document.querySelectorAll('.feature-card').forEach((card, index) => {
        const feature = content.features[index];
        if (!feature) return;
        setText(card.querySelector('h3'), feature.title);
        setText(card.querySelector('p'), feature.description);
        card.style.height = '100%';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        const paragraph = card.querySelector('p');
        if (paragraph) paragraph.style.flex = '1';
      });
    }
  }

  onReady(async () => {
    try {
      const response = await fetch(`${apiBase}/api/public-content`, {
        headers: { Accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      render(data.content || {});
    } catch (_) {
      // Keep each static marketing page usable if the content API is unavailable.
    }
  });
})();
