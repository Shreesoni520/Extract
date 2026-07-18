<?php
declare(strict_types=1);

/** Site icons for browser tabs + Google search listings. */
$faviconBase = '/Extract/assets/img';
$faviconAbs = (isset($_SERVER['HTTP_HOST'])
    ? ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http')
      . '://' . $_SERVER['HTTP_HOST']
    : '') . $faviconBase;
?>
<link rel="icon" href="<?= e($faviconBase) ?>/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="<?= e($faviconBase) ?>/favicon-32.png" type="image/png" sizes="32x32" />
<link rel="icon" href="<?= e($faviconBase) ?>/favicon-48.png" type="image/png" sizes="48x48" />
<link rel="shortcut icon" href="/Extract/favicon.ico" />
<link rel="apple-touch-icon" href="<?= e($faviconBase) ?>/apple-touch-icon.png" sizes="180x180" />
<meta name="theme-color" content="#111111" />
<meta property="og:image" content="<?= e($faviconAbs) ?>/og-image.png" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:image" content="<?= e($faviconAbs) ?>/og-image.png" />
