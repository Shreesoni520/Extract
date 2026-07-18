<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin();
start_session();

$pdo = db();
$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'add_user') {
    $user = trim((string) ($_POST['username'] ?? ''));
    $pass = (string) ($_POST['password'] ?? '');
    $confirm = (string) ($_POST['confirm'] ?? '');

    [$normalized, $userError] = parse_username($user);
    if ($userError !== null) {
        $error = $userError;
    } elseif (strlen($pass) < PASSWORD_MIN_LENGTH) {
        $error = 'Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters.';
    } elseif ($pass !== $confirm) {
        $error = 'Passwords do not match.';
    } elseif (username_collides($user)) {
        $error = username_taken_message();
    } elseif (create_admin($normalized, $pass)) {
        $message = 'User created. They can log in and upload files.';
    } else {
        $error = 'Could not create user.';
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete_user') {
    $id = (int) ($_POST['user_id'] ?? 0);
    $me = (int) ($_SESSION['admin_id'] ?? 0);
    if ($id > 0 && $id !== $me) {
        $count = (int) $pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
        if ($count <= 1) {
            $error = 'Cannot delete the last user.';
        } else {
            $pdo->prepare('DELETE FROM admins WHERE id = ?')->execute([$id]);
            $message = 'User deleted.';
        }
    } else {
        $error = 'You cannot delete your own account here.';
    }
}

$users = $pdo->query(
    'SELECT a.id, a.username, a.created_at,
            (SELECT COUNT(*) FROM items i WHERE i.admin_id = a.id) AS upload_count
     FROM admins a
     ORDER BY a.created_at ASC'
)->fetchAll();
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Users — Shree's Extractions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <link rel="stylesheet" href="/Extract/assets/css/app.css?v=6" />
  <?php require __DIR__ . '/../includes/theme-head.php'; ?>
  <style>
    .users-layout {
      display: grid;
      grid-template-columns: minmax(280px, 380px) 1fr;
      gap: 0.9rem;
      align-items: start;
    }
    @media (max-width: 900px) {
      .users-layout { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body class="admin-body">
  <?php require __DIR__ . '/../includes/dot-cursor.php'; ?>
  <?php $navContext = 'users'; require __DIR__ . '/../includes/nav.php'; ?>
  <header class="admin-top">
    <div>
      <h1>Users</h1>
    </div>
  </header>

  <main class="users-layout">
    <section class="panel">
      <h2>Add user</h2>
      <p class="hint">New users can log in, upload files, and appear in public search by username.</p>
      <?php if ($message): ?><div class="alert ok"><?= e($message) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="alert"><?= e($error) ?></div><?php endif; ?>
      <form method="post" class="upload-form" autocomplete="off">
        <input type="hidden" name="action" value="add_user" />
        <label>
          <span>Username</span>
          <input type="text" name="username" required minlength="3" maxlength="32"
                 pattern="[a-z0-9._-]+" placeholder="person name"
                 autocapitalize="off" autocorrect="off" spellcheck="false" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" name="password" required minlength="<?= PASSWORD_MIN_LENGTH ?>" />
        </label>
        <label>
          <span>Confirm password</span>
          <input type="password" name="confirm" required minlength="<?= PASSWORD_MIN_LENGTH ?>" />
        </label>
        <button type="submit">Create user</button>
      </form>
    </section>

    <section class="panel">
      <h2>All users</h2>
      <div class="item-table" style="margin-top: 1rem;">
        <?php foreach ($users as $u): ?>
          <article class="item-row">
            <div>
              <h3><?= e($u['username']) ?></h3>
              <p><?= (int) $u['upload_count'] ?> upload(s) · joined <?= e($u['created_at']) ?></p>
            </div>
            <div class="item-actions">
              <?php if ((int) $u['id'] !== (int) ($_SESSION['admin_id'] ?? 0)): ?>
                <form method="post" onsubmit="return confirm('Delete this user and their files?');">
                  <input type="hidden" name="action" value="delete_user" />
                  <input type="hidden" name="user_id" value="<?= (int) $u['id'] ?>" />
                  <button type="submit" class="ghost small">Delete</button>
                </form>
              <?php else: ?>
                <span class="hint">You</span>
              <?php endif; ?>
            </div>
          </article>
        <?php endforeach; ?>
      </div>
    </section>
  </main>
  <?php
    $skipFloatingTheme = true;
    require __DIR__ . '/../includes/theme-foot.php';
  ?>
</body>
</html>
