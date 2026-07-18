<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

start_session();

if (admin_logged_in()) {
    after_login_redirect();
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim((string) ($_POST['username'] ?? ''));
    $pass = (string) ($_POST['password'] ?? '');
    if ($user === '' || $pass === '') {
        $error = 'Enter username and password.';
    } elseif (attempt_login($user, $pass)) {
        after_login_redirect();
    } else {
        $error = 'Invalid credentials.';
    }
}
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in — Shree's Extractions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <link rel="stylesheet" href="/Extract/assets/css/app.css?v=6" />
  <?php require __DIR__ . '/../includes/theme-head.php'; ?>
</head>
<body class="login-body">
  <?php require __DIR__ . '/../includes/dot-cursor.php'; ?>
  <a class="nav-btn login-back" href="/Extract/">← Back</a>
  <div class="login-wrap">
    <h1>Sign in</h1>
    <p class="sub">Sign in first to find people and use files.</p>
    <?php if ($error): ?>
      <div class="alert"><?= e($error) ?></div>
    <?php endif; ?>
    <form method="post" class="login-form" autocomplete="off">
      <label>
        <span>Username</span>
        <input type="text" name="username" required autofocus
               autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="yourname" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" name="password" required />
      </label>
      <button type="submit">Sign in</button>
    </form>
    <p class="auth-switch">
      New here?
      <a href="/Extract/app/register.php">Sign up</a>
    </p>
  </div>
  <?php require __DIR__ . '/../includes/theme-foot.php'; ?>
</body>
</html>
