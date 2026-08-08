/**
 * Smooth black wipe — sliding panel bottom → top.
 * Cover: panel slides up from below.
 * Reveal: panel keeps sliding up and off-screen.
 * Load/reload: one continuous pass (smoother than two hard cuts).
 */
(function () {
  'use strict';

  const COVER_MS = 520;
  const REVEAL_MS = 520;
  const PASS_MS = 900;
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

  function resetVeil(veil) {
    veil.classList.remove('cover', 'reveal', 'pass', 'is-soft');
    veil.style.transform = '';
    veil.style.opacity = '';
    void veil.offsetWidth;
  }

  async function play(mode) {
    if (reducedMotion()) return;
    const veil = ensureVeil();
    resetVeil(veil);
    veil.classList.add(mode);
    const ms = mode === 'pass' ? PASS_MS : (mode === 'cover' ? COVER_MS : REVEAL_MS);
    await wait(ms);
    if (mode === 'reveal' || mode === 'pass') {
      resetVeil(veil);
      veil.style.transform = 'translate3d(0, 100%, 0)';
    }
  }

  async function cover() {
    return play('cover');
  }

  async function reveal() {
    return play('reveal');
  }

  /** Continuous bottom→top pass (best for load/reload). */
  async function wipeUp() {
    if (reducedMotion()) return;
    return play('pass');
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
    let fromNav = false;
    try {
      fromNav = sessionStorage.getItem(FLAG) === '1';
      sessionStorage.removeItem(FLAG);
    } catch (_) {}

    // Coming from another page: already covered — just lift away smoothly.
    if (fromNav) {
      const veil = ensureVeil();
      resetVeil(veil);
      veil.style.transform = 'translate3d(0, 0, 0)';
      await wait(20);
      veil.style.transform = '';
      await reveal();
      return;
    }

    // Fresh load / reload: one continuous up-pass.
    await wait(30);
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
