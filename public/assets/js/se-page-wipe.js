/**
 * Full-screen black wipe (rises up to cover, then lifts away).
 * Used on real page navigations + in-app view swaps.
 */
(function () {
  'use strict';

  const COVER_MS = 380;
  const REVEAL_MS = 380;
  const FLAG = 'se_wipe_pending';

  function reducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function ensureVeil() {
    let veil = document.getElementById('pageVeil');
    if (veil) return veil;
    veil = document.createElement('div');
    veil.id = 'pageVeil';
    veil.className = 'page-veil';
    veil.setAttribute('aria-hidden', 'true');
    document.body.appendChild(veil);
    return veil;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function play(mode) {
    if (reducedMotion()) return;
    const veil = ensureVeil();
    veil.classList.remove('cover', 'reveal', 'is-soft');
    // Restart animation
    void veil.offsetWidth;
    veil.classList.add(mode);
    await wait(mode === 'cover' ? COVER_MS : REVEAL_MS);
    if (mode === 'reveal') {
      veil.classList.remove('cover', 'reveal');
    }
  }

  async function cover() {
    return play('cover');
  }

  async function reveal() {
    return play('reveal');
  }

  async function navigate(url) {
    if (!url) return;
    try {
      sessionStorage.setItem(FLAG, '1');
    } catch (_) {}
    await cover();
    window.location.href = url;
  }

  function sameOrigin(href) {
    try {
      const u = new URL(href, window.location.href);
      return u.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function shouldWipeLink(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.dataset.noWipe === '1') return false;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    if (!sameOrigin(href)) return false;
    // Stay on same page hash-only already excluded
    try {
      const next = new URL(href, window.location.href);
      const cur = window.location;
      if (next.pathname === cur.pathname && next.search === cur.search && next.hash) return false;
    } catch (_) {}
    return true;
  }

  function bindLinkWipes() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!shouldWipeLink(a)) return;
      e.preventDefault();
      navigate(a.href);
    }, true);
  }

  async function maybeRevealOnLoad() {
    let pending = false;
    try {
      pending = sessionStorage.getItem(FLAG) === '1';
      sessionStorage.removeItem(FLAG);
    } catch (_) {}
    if (!pending || reducedMotion()) return;
    const veil = ensureVeil();
    // Start covered, then lift away upward
    veil.classList.add('cover');
    veil.style.transform = 'scaleY(1)';
    veil.style.opacity = '1';
    veil.style.transformOrigin = 'top center';
    await wait(16);
    veil.style.transform = '';
    veil.style.opacity = '';
    await reveal();
  }

  window.SE_pageWipe = {
    cover,
    reveal,
    navigate,
    ensureVeil,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureVeil();
      bindLinkWipes();
      maybeRevealOnLoad();
    });
  } else {
    ensureVeil();
    bindLinkWipes();
    maybeRevealOnLoad();
  }
})();
