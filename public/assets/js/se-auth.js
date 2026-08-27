(function () {
  'use strict';

  function rootPath() {
    if (window.SEStore && typeof window.SEStore.root === 'string') {
      return window.SEStore.root;
    }
    if (!/^\/Extract(\/|$)/i.test(window.location.pathname)) return '';
    return '/Extract';
  }

  function homeUrl() {
    const r = rootPath();
    return r ? `${r}/` : '/';
  }

  function loginUrl(nextPath) {
    const base = `${rootPath()}/login`;
    if (!nextPath) return base;
    return `${base}?next=${encodeURIComponent(nextPath)}`;
  }

  function registerUrl() {
    return `${rootPath()}/register`;
  }

  function pathOf() {
    return window.location.pathname || '/';
  }

  function isLoginPage() {
    return /\/login(?:\.html)?$/i.test(pathOf()) || /login\.html/i.test(pathOf());
  }

  function isRegisterPage() {
    return /\/register(?:\.html)?$/i.test(pathOf()) || /register\.html/i.test(pathOf());
  }

  function isAuthPage() {
    return isLoginPage() || isRegisterPage();
  }

  function isProtected() {
    return /\/app\/(index|account|users)\.html/i.test(pathOf());
  }

  function isHome() {
    const path = pathOf();
    return path === '/'
      || /^\/index\.html$/i.test(path)
      || /^\/Extract\/?$/i.test(path)
      || /^\/Extract\/index\.html$/i.test(path);
  }

  function safeNextPath() {
    try {
      const n = new URLSearchParams(window.location.search).get('next') || '';
      if (!n || !n.startsWith('/') || n.startsWith('//')) return homeUrl();
      if (/^https?:/i.test(n)) return homeUrl();
      return n;
    } catch (_) {
      return homeUrl();
    }
  }

  function redirect(path) {
    window.location.replace(path);
  }

  function revealAuthedUi() {
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-ok');
    const user = window.SEStore && window.SEStore.getCurrentUser && window.SEStore.getCurrentUser();
    document.querySelectorAll('[data-se-username]').forEach((el) => {
      if (user && user.username) el.textContent = `@${user.username}`;
    });
  }

  function unstickAuthGate() {
    document.documentElement.classList.remove('auth-pending');
  }

  function clearLocalSession() {
    try { sessionStorage.removeItem('se_user_hint'); } catch (_) {}
    try { localStorage.removeItem('se_session_v1'); } catch (_) {}
    try { localStorage.removeItem('se_user_hint'); } catch (_) {}
  }

  function ensureToastHost() {
    let host = document.getElementById('seToasts');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'seToasts';
    host.className = 'se-toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  function showToast(text) {
    const message = String(text || '').trim();
    if (!message) return;
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'se-toast se-toast-error';
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, 4200);
  }

  async function performLogout() {
    clearLocalSession();
    const logoutCall = (async () => {
      if (window.SEStore && typeof window.SEStore.logout === 'function') {
        await window.SEStore.logout();
        return;
      }
    })();
    await Promise.race([
      logoutCall.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    clearLocalSession();
  }

  function goLoggedOut() {
    clearLocalSession();
    window.location.replace(`${homeUrl()}?logged_out=1`);
  }

  function bindLogoutLinks() {
    if (document.documentElement.dataset.seLogoutDelegation === '1') return;
    document.documentElement.dataset.seLogoutDelegation = '1';
    document.addEventListener('click', async (e) => {
      const a = e.target && e.target.closest
        ? e.target.closest('[data-se-logout], a[href*="#logout"], #logoutLink, #navLogout')
        : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (a.dataset.seLoggingOut === '1') return;
      a.dataset.seLoggingOut = '1';
      try {
        a.setAttribute('aria-busy', 'true');
        if ('disabled' in a) a.disabled = true;
        await performLogout();
      } catch (_) {
        // still leave
      } finally {
        goLoggedOut();
      }
    }, true);
  }

  function locallyLoggedIn() {
    return !!(window.SEStore && window.SEStore.adminLoggedIn && window.SEStore.adminLoggedIn());
  }

  async function bindAuthForm() {
    const form = document.querySelector('form.login-form');
    if (!form) return;
    const mode = isRegisterPage() ? 'register' : 'login';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.seBusy === '1') return;
      form.dataset.seBusy = '1';
      const btn = form.querySelector('button[type="submit"]');
      const original = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Please wait...';
      }
      try {
        const fd = new FormData(form);
        const username = String(fd.get('username') || '');
        const password = String(fd.get('password') || '');
        const confirm = String(fd.get('confirm') || '');
        const res = mode === 'register'
          ? await window.SEStore.register(username, password, confirm)
          : await window.SEStore.login(username, password);
        if (res && res.ok) {
          redirect(safeNextPath() || homeUrl());
          return;
        }
        showToast((res && res.error) || (mode === 'register' ? 'Could not continue' : 'Could not continue'));
        form.dataset.seBusy = '0';
        if (btn) {
          btn.disabled = false;
          btn.textContent = original || (mode === 'register' ? 'Sign up' : 'Sign in');
        }
      } catch (err) {
        showToast((err && err.message) || 'Could not continue');
        form.dataset.seBusy = '0';
        if (btn) {
          btn.disabled = false;
          btn.textContent = original || (mode === 'register' ? 'Sign up' : 'Sign in');
        }
      }
    });
  }

  async function initAuth() {
    const failsafe = setTimeout(unstickAuthGate, 4000);
    try {
      if (!window.SEStore) {
        unstickAuthGate();
        return;
      }

      if (isHome()) {
        bindLogoutLinks();
        document.addEventListener('se-home-ready', bindLogoutLinks);
        unstickAuthGate();
        return;
      }

      await window.SEStore.init({ force: true });

      if (isLoginPage() && /logout/i.test(window.location.hash || '')) {
        await window.SEStore.logout();
        history.replaceState(null, '', loginUrl());
      }

      if (isProtected() && !locallyLoggedIn()) {
        unstickAuthGate();
        redirect(homeUrl());
        return;
      }

      if (locallyLoggedIn() && isAuthPage()) {
        redirect(homeUrl());
        return;
      }

      if (isProtected() && locallyLoggedIn()) {
        revealAuthedUi();
      } else {
        unstickAuthGate();
      }

      if (isAuthPage()) {
        await bindAuthForm();
      }

      bindLogoutLinks();
      document.addEventListener('se-home-ready', bindLogoutLinks);
    } catch (_) {
      unstickAuthGate();
    } finally {
      clearTimeout(failsafe);
    }
  }

  window.SE_requireAuth = async function requireAuth() {
    if (!window.SEStore) {
      unstickAuthGate();
      redirect(homeUrl());
      return false;
    }
    try {
      await window.SEStore.init({ force: true });
      if (!locallyLoggedIn()) {
        unstickAuthGate();
        redirect(homeUrl());
        return false;
      }
      revealAuthedUi();
      return true;
    } catch (_) {
      unstickAuthGate();
      redirect(homeUrl());
      return false;
    }
  };

  window.SE_showToast = showToast;
  window.SE_loginUrl = loginUrl;
  window.SE_registerUrl = registerUrl;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuth);
  else initAuth();
})();
