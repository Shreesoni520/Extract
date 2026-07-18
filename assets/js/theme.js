(() => {
  const KEY = 'se_theme';
  const root = document.documentElement;
  const btn = document.getElementById('themeToggle');

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
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
    updateButton();
  }

  function updateButton() {
    if (!btn) return;
    const dark = currentTheme() === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.textContent = dark ? 'Light' : 'Dark';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  btn?.addEventListener('click', () => {
    apply(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  updateButton();
})();
