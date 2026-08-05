(function () {
  'use strict';

  function showAlert(container, text, ok) {
    if (!container || !text) return;
    container.innerHTML = `<div class="alert${ok ? ' ok' : ''}">${String(text).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div>`;
  }

  function redirect(path) {
    window.location.replace(path);
  }

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
    const base = `${rootPath()}/app/login.html`;
    if (!nextPath) return base;
    return `${base}?next=${encodeURIComponent(nextPath)}`;
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

  function currentAppPath() {
    return `${window.location.pathname}${window.location.search || ''}`;
  }

  function revealAuthedUi() {
    document.documentElement.classList.remove('auth-pending');
    document.documentElement.classList.add('auth-ok');
    const user = window.SEStore && window.SEStore.getCurrentUser && window.SEStore.getCurrentUser();
    document.querySelectorAll('[data-se-username]').forEach((el) => {
      if (user && user.username) el.textContent = `@${user.username}`;
    });
  }

  function bindLogoutLinks() {
    document.querySelectorAll('[data-se-logout], a[href*="#logout"], #logoutLink, #navLogout').forEach((a) => {
      if (a.dataset.seLogoutBound === '1') return;
      a.dataset.seLogoutBound = '1';
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await window.SEStore.logout();
        } catch (_) {}
        redirect(homeUrl());
      });
    });
  }

  async function initAuth() {
    if (!window.SEStore) return;

    const isLogin = /login\.html/i.test(window.location.pathname);
    const isRegister = /register\.html/i.test(window.location.pathname);
    const isProtected = /\/app\/(index|account|users)\.html/i.test(window.location.pathname);
    const path = window.location.pathname || '/';
    const isHome = path === '/'
      || /^\/index\.html$/i.test(path)
      || /^\/Extract\/?$/i.test(path)
      || /^\/Extract\/index\.html$/i.test(path);

    // Home already calls SEStore.init — avoid a second forced /me round-trip.
    await window.SEStore.init({ force: !isHome });

    // Old links used login.html#logout — handle that without bouncing other pages.
    if (isLogin && /logout/i.test(window.location.hash || '')) {
      await window.SEStore.logout();
      history.replaceState(null, '', loginUrl());
    }

    if (isProtected && !window.SEStore.adminLoggedIn()) {
      redirect(homeUrl());
      return;
    }

    if (window.SEStore.adminLoggedIn() && (isLogin || isRegister)) {
      redirect(homeUrl());
      return;
    }

    if (isProtected && window.SEStore.adminLoggedIn()) {
      revealAuthedUi();
    }

    if (isLogin) {
      const form = document.querySelector('form.login-form');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
          const fd = new FormData(form);
          const res = await window.SEStore.login(fd.get('username'), fd.get('password'));
          if (res && res.ok) redirect(homeUrl());
          else showAlert(document.getElementById('authAlert'), (res && res.error) || 'Login failed.', false);
        } catch (_) {
          showAlert(document.getElementById('authAlert'), 'Login failed. Please try again.', false);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    if (isRegister) {
      const form = document.querySelector('form.login-form');
      const userInput = form?.querySelector('input[name="username"]');
      const hint = document.getElementById('usernameHint');
      let checkTimer = null;

      async function checkUsernameLive() {
        if (!userInput) return;
        const raw = String(userInput.value || '').trim();
        if (!raw || raw.length < 3) {
          if (hint) {
            hint.hidden = true;
            hint.textContent = '';
            hint.className = 'field-hint';
          }
          return;
        }
        try {
          const res = await fetch(`/api/auth/check-username?u=${encodeURIComponent(raw)}`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const data = await res.json().catch(() => ({}));
          if (!hint) return;
          if (data.available) {
            hint.hidden = false;
            hint.className = 'field-hint ok';
            hint.textContent = `@${data.username} is available`;
          } else {
            hint.hidden = false;
            hint.className = 'field-hint bad';
            hint.textContent = data.error || 'That username is already registered. Sign in instead.';
          }
        } catch (_) {
          if (hint) hint.hidden = true;
        }
      }

      userInput?.addEventListener('input', () => {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = setTimeout(checkUsernameLive, 280);
      });
      userInput?.addEventListener('blur', checkUsernameLive);

      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
          const fd = new FormData(form);
          const res = await window.SEStore.register(fd.get('username'), fd.get('password'), fd.get('confirm'));
          if (res && res.ok) redirect(homeUrl());
          else {
            const msg = (res && res.error) || 'Registration failed.';
            showAlert(document.getElementById('authAlert'), msg, false);
            if (res && (res.code === 'USERNAME_TAKEN' || /already registered|already taken|not available|in use/i.test(msg))) {
              if (hint) {
                hint.hidden = false;
                hint.className = 'field-hint bad';
                hint.textContent = msg;
              }
            }
          }
        } catch (_) {
          showAlert(document.getElementById('authAlert'), 'Registration failed. Please try again.', false);
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    bindLogoutLinks();
  }

  window.SE_requireAuth = async function requireAuth() {
    if (!window.SEStore) {
      redirect(homeUrl());
      return false;
    }
    await window.SEStore.init({ force: true });
    if (!window.SEStore.adminLoggedIn()) {
      redirect(homeUrl());
      return false;
    }
    revealAuthedUi();
    return true;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAuth);
  else initAuth();
})();
