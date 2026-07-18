<?php
declare(strict_types=1);
/** Apply saved theme before paint to avoid a flash of the wrong mode. */
require_once __DIR__ . '/favicon.php';
?>
<script>
(function () {
  try {
    if (localStorage.getItem('se_theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (_) {}
})();
</script>
