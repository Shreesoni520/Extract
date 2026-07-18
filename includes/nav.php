<?php
// Shared top navigation — set $navContext before include:
// 'browse' | 'upload' | 'account' | 'users'
declare(strict_types=1);

$ctx = $navContext ?? 'browse';
$home = '/Extract/';
$browse = '/Extract/?browse=1';
$upload = '/Extract/app/';
$account = '/Extract/app/account.php';
$logout = '/Extract/app/logout.php';

// End buttons: Find people first (except on browse), then page action, theme, logout
$links = [];
if ($ctx !== 'browse') {
    $links[] = ['href' => $browse, 'label' => 'Find people'];
}
if ($ctx === 'upload') {
    $links[] = ['href' => $account, 'label' => 'Account'];
} elseif ($ctx === 'account') {
    $links[] = ['href' => $upload, 'label' => 'Upload files'];
} elseif ($ctx === 'users') {
    $links[] = ['href' => $upload, 'label' => 'Upload files'];
    $links[] = ['href' => $account, 'label' => 'Account'];
} else {
    // browse — already finding people
    $links[] = ['href' => $upload, 'label' => 'Upload files'];
    $links[] = ['href' => $account, 'label' => 'Account'];
}
?>
<nav class="app-nav" aria-label="Main">
  <?php if ($ctx === 'browse'): ?>
    <button class="nav-btn" id="backBtn" type="button">← Back</button>
  <?php else: ?>
    <a class="nav-btn" href="<?= e($home) ?>">← Back</a>
  <?php endif; ?>
  <div class="app-nav-end">
    <?php foreach ($links as $btn): ?>
      <a class="nav-btn" href="<?= e($btn['href']) ?>"><?= e($btn['label']) ?></a>
    <?php endforeach; ?>
    <button type="button" class="nav-btn" id="themeToggle" aria-label="Toggle dark mode" aria-pressed="false">Dark</button>
    <a class="nav-btn nav-btn-dark" href="<?= e($logout) ?>">Logout</a>
  </div>
</nav>
