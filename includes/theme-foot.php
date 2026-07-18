<?php
declare(strict_types=1);
/** Theme script — include once before </body>. */
?>
<?php if (empty($skipFloatingTheme)): ?>
<script>
(function () {
  if (!document.getElementById('themeToggle')) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-toggle';
    b.id = 'themeToggle';
    b.setAttribute('aria-label', 'Toggle dark mode');
    b.setAttribute('aria-pressed', 'false');
    b.textContent = 'Dark';
    document.body.appendChild(b);
  }
})();
</script>
<?php endif; ?>
<script src="/Extract/assets/js/theme.js?v=2" defer></script>
