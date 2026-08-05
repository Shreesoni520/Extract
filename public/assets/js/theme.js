(() => {
  const KEY = 'se_theme';
  const root = document.documentElement;

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
})();
