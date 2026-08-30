(() => {
  const KEY = 'se_theme';
  const root = document.documentElement;
  let navTimer = 0;
  let navGen = 0;

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function themeButtons() {
    return document.querySelectorAll('#themeToggle, .theme-toggle, [data-se-theme]');
  }

  function updateButtons() {
    const dark = currentTheme() === 'dark';
    themeButtons().forEach((btn) => {
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.textContent = dark ? 'Light' : 'Dark';
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  function apply(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem(KEY, theme);
    } catch (_) {}
    updateButtons();
  }

  function clearPageOut() {
    navGen += 1;
    if (navTimer) {
      window.clearTimeout(navTimer);
      navTimer = 0;
    }
    root.classList.remove('se-page-out');
    document.querySelectorAll('.se-view-out').forEach((el) => {
      el.classList.remove('se-view-out');
    });
  }

  // Back/forward cache keeps the faded-out page. Restore it immediately.
  window.addEventListener('pageshow', clearPageOut);
  window.addEventListener('pagehide', clearPageOut);
  window.addEventListener('popstate', clearPageOut);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clearPageOut();
  });

  // Event delegation so dynamically injected nav toggles always work
  // (home browse view hides the floating button and uses a nav button).
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest
      ? e.target.closest('#themeToggle, .theme-toggle, [data-se-theme]')
      : null;
    if (!btn) return;
    e.preventDefault();
    apply(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  document.addEventListener('se-home-ready', updateButtons);
  updateButtons();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add('se-theme-smooth');
    });
  });

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('data-se-logout')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
    let url;
    try { url = new URL(a.href, window.location.href); } catch (_) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    e.preventDefault();
    const gen = navGen + 1;
    navGen = gen;
    root.classList.add('se-page-out');
    navTimer = window.setTimeout(() => {
      navTimer = 0;
      if (navGen !== gen) return;
      window.location.href = url.href;
    }, 160);
  });
})();
