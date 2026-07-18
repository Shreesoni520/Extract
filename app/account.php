<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin();
start_session();
ensure_upload_dir();

$message = '';
$error = '';
$adminId = (int) ($_SESSION['admin_id'] ?? 0);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'avatar') {
    $file = $_FILES['avatar'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $error = 'Choose a profile image.';
    } else {
        $mime = mime_content_type((string) $file['tmp_name']) ?: '';
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        if (!isset($allowed[$mime])) {
            $error = 'Use JPG, PNG, WEBP, or GIF.';
        } elseif (($file['size'] ?? 0) > 3 * 1024 * 1024) {
            $error = 'Image too large (max 3 MB).';
        } else {
            $stored = bin2hex(random_bytes(12)) . '.' . $allowed[$mime];
            $dest = app_config()['app']['upload_dir'] . '/avatars/' . $stored;
            $old = db()->prepare('SELECT avatar FROM admins WHERE id = ?');
            $old->execute([$adminId]);
            $oldName = $old->fetchColumn();
            if (!move_uploaded_file((string) $file['tmp_name'], $dest)) {
                $error = 'Could not save image.';
            } else {
                db()->prepare('UPDATE admins SET avatar = ? WHERE id = ?')->execute([$stored, $adminId]);
                if (is_string($oldName) && $oldName !== '') {
                    $oldPath = app_config()['app']['upload_dir'] . '/avatars/' . basename($oldName);
                    if (is_file($oldPath)) {
                        @unlink($oldPath);
                    }
                }
                $message = 'Profile image updated.';
            }
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'account') {
    $current = (string) ($_POST['current_password'] ?? '');
    $newUser = trim((string) ($_POST['new_username'] ?? ''));
    $newPass = (string) ($_POST['new_password'] ?? '');
    $confirm = (string) ($_POST['confirm_password'] ?? '');

    $stmt = db()->prepare('SELECT id, username, password_hash FROM admins WHERE id = ? LIMIT 1');
    $stmt->execute([$adminId]);
    $admin = $stmt->fetch();

    if (!$admin) {
        logout_admin();
        header('Location: /Extract/app/login.php');
        exit;
    } elseif ($newUser === '' || strlen($newUser) < 3) {
        $error = 'Username must be at least 3 characters.';
    } elseif ($newPass !== '' && strlen($newPass) < PASSWORD_MIN_LENGTH) {
        $error = 'New password must be at least ' . PASSWORD_MIN_LENGTH . ' characters.';
    } elseif ($newPass !== '' && ($current === '' || !password_verify($current, $admin['password_hash']))) {
        $error = 'To change your password, enter the password you already use to sign in.';
    } else {
        [$normalized, $userError] = parse_username($newUser);
        if ($userError !== null) {
            $error = $userError;
        } elseif ($newPass !== '' && $newPass !== $confirm) {
            $error = 'New password and confirm do not match.';
        } elseif (username_collides($newUser, $adminId)) {
            $error = username_taken_message();
        } else {
            if ($newPass !== '') {
                $hash = password_hash($newPass, PASSWORD_DEFAULT);
                $upd = db()->prepare('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?');
                $upd->execute([$normalized, $hash, $adminId]);
                $message = 'Username and password updated.';
            } else {
                $upd = db()->prepare('UPDATE admins SET username = ? WHERE id = ?');
                $upd->execute([$normalized, $adminId]);
                $message = $normalized !== (string) $admin['username']
                    ? 'Username updated.'
                    : 'Nothing to change.';
            }
            $_SESSION['admin_username'] = $normalized;
        }
    }
}

$profile = db()->prepare('SELECT username, avatar FROM admins WHERE id = ? LIMIT 1');
$profile->execute([$adminId]);
$me = $profile->fetch() ?: ['username' => '', 'avatar' => null];
$currentUsername = (string) $me['username'];
$avatarSrc = avatar_url($me['avatar'] ? (string) $me['avatar'] : null, $adminId);
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Account — Shree's Extractions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <link rel="stylesheet" href="/Extract/assets/css/app.css?v=6" />
  <?php require __DIR__ . '/../includes/theme-head.php'; ?>
  <style>
    .account-page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background:
        radial-gradient(800px 360px at 100% 0%, rgba(15, 92, 92, 0.08), transparent 55%),
        #f3f5f7;
    }
    .account-top {
      padding: 0;
      width: 100%;
      box-sizing: border-box;
    }
    .account-top .app-nav {
      margin-bottom: 1.15rem;
    }
    .account-center {
      flex: 1;
      padding: 0 var(--gutter) 2.5rem;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      box-sizing: border-box;
    }
    .account-wrap {
      width: 100%;
      max-width: 920px;
      display: grid;
      gap: 0.9rem;
    }
    .account-stack {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(260px, 340px) minmax(280px, 1fr);
      gap: 0.9rem;
      align-items: stretch;
    }
    @media (max-width: 820px) {
      .account-stack { grid-template-columns: 1fr; }
    }
    .account-box {
      width: 100%;
      padding: 1.85rem 1.6rem;
      background: #fff;
      border: 1px solid #dce1e6;
      border-radius: 18px;
      box-shadow: 0 1px 2px rgba(18, 21, 26, 0.04), 0 12px 32px rgba(18, 21, 26, 0.06);
    }
    .account-box h1, .account-box h2 {
      margin: 0 0 0.35rem;
      font-family: "Sora", system-ui, sans-serif;
      letter-spacing: -0.03em;
      color: #12151a;
    }
    .account-box h1 { font-size: 1.7rem; }
    .account-box h2 { font-size: 1.15rem; }
    .account-box .sub {
      margin: 0 0 1.1rem;
      color: #5c6570;
      font-size: 0.95rem;
    }
    .account-box .login-form { margin-top: 0; }
    .account-box label span em {
      font-style: normal;
      font-weight: 500;
      color: #9aa3ad;
      text-transform: none;
      letter-spacing: 0;
    }
    .avatar-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      text-align: center;
    }
    .avatar-preview img {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid #dce1e6;
      background: #111;
    }
    .avatar-preview .hint { margin: 0; font-size: 0.88rem; }
    .avatar-pick {
      position: relative;
      display: grid;
      place-items: center;
      gap: 0.25rem;
      min-height: 104px;
      padding: 1rem;
      border: 1.5px dashed #cfd5dc;
      border-radius: 14px;
      background: #f8fafb;
      cursor: pointer;
      text-align: center;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .avatar-pick:hover,
    .avatar-pick.has-file {
      border-color: #111;
      background: #f3f5f7;
    }
    .avatar-pick input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
    }
    .avatar-pick-title { font-weight: 600; color: #12151a; }
    .avatar-pick-sub { font-size: 0.88rem; color: #5c6570; }
  </style>
</head>
<body class="account-page">
  <?php require __DIR__ . '/../includes/dot-cursor.php'; ?>
  <div class="account-top">
    <?php $navContext = 'account'; require __DIR__ . '/../includes/nav.php'; ?>
  </div>

  <div class="account-center">
    <div class="account-wrap">
      <?php if ($message): ?><div class="alert ok"><?= e($message) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="alert"><?= e($error) ?></div><?php endif; ?>

      <div class="account-stack">
        <section class="account-box">
          <h2>Profile image</h2>
          <p class="sub">Shown when people search for your username.</p>
          <div class="avatar-preview">
            <img id="avatarPreview" src="<?= e($avatarSrc) ?>" alt="Profile" />
            <p class="hint">JPG, PNG, WEBP or GIF · max 3 MB</p>
          </div>
          <form method="post" enctype="multipart/form-data" class="login-form" id="avatarForm">
            <input type="hidden" name="action" value="avatar" />
            <label class="avatar-pick" id="avatarPick" for="avatarInput">
              <input id="avatarInput" type="file" name="avatar" accept="image/*" required />
              <span class="avatar-pick-title">Choose image</span>
              <span class="avatar-pick-sub" id="avatarFileName">Click or drop a photo here</span>
            </label>
            <button type="submit">Save image</button>
          </form>
        </section>

        <section class="account-box">
          <h1>Account</h1>
          <p class="sub">Change your username anytime. Only fill the password fields if you want a new password.</p>
          <form method="post" class="login-form" autocomplete="off" id="accountForm">
            <input type="hidden" name="action" value="account" />
            <label>
              <span>Username</span>
              <input type="text" name="new_username" required minlength="3" maxlength="32"
                     pattern="[a-z0-9._-]+" value="<?= e($currentUsername) ?>"
                     autocapitalize="off" autocorrect="off" spellcheck="false" />
            </label>
            <label>
              <span>New password <em>(optional)</em></span>
              <input type="password" name="new_password" id="newPassword" minlength="<?= PASSWORD_MIN_LENGTH ?>" placeholder="Leave blank to keep your signup password" />
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" name="confirm_password" id="confirmPassword" minlength="<?= PASSWORD_MIN_LENGTH ?>" />
            </label>
            <label id="currentPassWrap" hidden>
              <span>Your signup / sign-in password</span>
              <input type="password" name="current_password" id="currentPassword" autocomplete="current-password" placeholder="Only needed to set a new password" />
            </label>
            <p class="hint" id="passHint" hidden>To change your password, confirm the one you already use to sign in.</p>
            <button type="submit">Save changes</button>
          </form>
        </section>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const input = document.getElementById('avatarInput');
      const pick = document.getElementById('avatarPick');
      const nameEl = document.getElementById('avatarFileName');
      const preview = document.getElementById('avatarPreview');
      if (input && pick) {
        const showFile = (file) => {
          if (!file) return;
          pick.classList.add('has-file');
          if (nameEl) nameEl.textContent = file.name;
          if (preview && file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            preview.onload = () => URL.revokeObjectURL(url);
            preview.src = url;
          }
        };

        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          showFile(file);
        });

        ['dragenter', 'dragover'].forEach((ev) => {
          pick.addEventListener(ev, (e) => {
            e.preventDefault();
            pick.classList.add('has-file');
          });
        });
        pick.addEventListener('dragleave', () => {
          if (!(input.files && input.files[0])) pick.classList.remove('has-file');
        });
        pick.addEventListener('drop', (e) => {
          e.preventDefault();
          const file = e.dataTransfer?.files?.[0];
          if (!file) return;
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          showFile(file);
        });
      }

      const newPass = document.getElementById('newPassword');
      const confirmPass = document.getElementById('confirmPassword');
      const currentWrap = document.getElementById('currentPassWrap');
      const currentPass = document.getElementById('currentPassword');
      const passHint = document.getElementById('passHint');

      const syncPassFields = () => {
        const changing = !!(newPass?.value || confirmPass?.value);
        if (currentWrap) currentWrap.hidden = !changing;
        if (passHint) passHint.hidden = !changing;
        if (currentPass) {
          currentPass.required = changing;
          if (!changing) currentPass.value = '';
        }
      };

      newPass?.addEventListener('input', syncPassFields);
      confirmPass?.addEventListener('input', syncPassFields);
      syncPassFields();
    })();
  </script>
  <?php
    $skipFloatingTheme = true;
    require __DIR__ . '/../includes/theme-foot.php';
  ?>
</body>
</html>
