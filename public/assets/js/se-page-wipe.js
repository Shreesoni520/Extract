/**
 * Full-screen black wipe — bottom → top.
 * Cover: black rises from the bottom.
 * Reveal: black keeps going up and lifts away.
 * Plays on link navigations, in-app swaps, and every page load/reload.
 */
(function () {
  'use strict';

  const COVER_MS = 400;
  const REVEAL_MS = 400;
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

  /** Full bottom→top cycle: rise up to cover, then continue up and leave. */
  async function wipeUp() {
    if (reducedMotion()) return;
    await cover();
    await reveal();
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

  async function playOnLoad() {
    if (reducedMotion()) return;
    try {
      sessionStorage.removeItem(FLAG);
    } catch (_) {}
    // Let the page paint once, then run bottom→top wipe on every load/reload.
    await wait(50);
    await wipeUp();
  }

  window.SE_pageWipe = {
    cover,
    reveal,
    wipeUp,
    navigate,
    ensureVeil,
  };

  function boot() {
    ensureVeil();
    bindLinkWipes();
    playOnLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
