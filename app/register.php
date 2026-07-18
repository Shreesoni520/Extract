<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

start_session();

if (admin_logged_in()) {
    after_login_redirect();
}

$error = '';
$usernameValue = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim((string) ($_POST['username'] ?? ''));
    $pass = (string) ($_POST['password'] ?? '');
    $confirm = (string) ($_POST['confirm'] ?? '');
    $usernameValue = strtolower(trim($user));

    [$normalized, $userError] = parse_username($user);
    if ($userError !== null) {
        $error = $userError;
    } elseif (strlen($pass) < PASSWORD_MIN_LENGTH) {
        $error = 'Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters.';
    } elseif ($pass !== $confirm) {
        $error = 'Passwords do not match.';
    } elseif (username_collides($user)) {
        $error = username_taken_message();
    } elseif (create_admin($normalized, $pass) && attempt_login($normalized, $pass)) {
        after_login_redirect();
    } else {
        $error = 'Could not create account. Try again.';
    }
}
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign up — Shree's Extractions</title>
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
    <h1>Sign up</h1>
    <p class="sub">Create an account, then you can find people and upload files.</p>
    <?php if ($error): ?>
      <div class="alert"><?= e($error) ?></div>
    <?php endif; ?>
    <form method="post" class="login-form" autocomplete="off">
      <label>
        <span>Username</span>
        <input type="text" name="username" required minlength="3" maxlength="32"
               pattern="[a-z0-9._-]+" value="<?= e($usernameValue) ?>" autofocus
               autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="yourname" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" name="password" required minlength="<?= PASSWORD_MIN_LENGTH ?>" />
      </label>
      <label>
        <span>Confirm password</span>
        <input type="password" name="confirm" required minlength="<?= PASSWORD_MIN_LENGTH ?>" />
      </label>
      <button type="submit">Sign up</button>
    </form>
    <p class="auth-switch">
      Already have an account?
      <a href="/Extract/app/login.php">Sign in</a>
    </p>
  </div>
  <?php require __DIR__ . '/../includes/theme-foot.php'; ?>
</body>
</html>
