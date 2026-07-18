<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin();
start_session();

$pdo = db();
$cfg = app_config()['app'];
ensure_upload_dir();

function flash_redirect(string $type, string $text): void
{
    $_SESSION['flash'] = ['type' => $type, 'text' => $text];
    header('Location: /Extract/app/');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'upload') {
    $title = trim((string) ($_POST['title'] ?? ''));
    $description = trim((string) ($_POST['description'] ?? ''));
    $file = $_FILES['file'] ?? null;

    if ($title === '') {
        flash_redirect('error', 'Title is required.');
    }
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        flash_redirect('error', 'Choose a file to upload.');
    }
    if (($file['size'] ?? 0) > $cfg['max_upload_bytes']) {
        flash_redirect('error', 'File is too large (max 50 MB).');
    }

    $ext = pathinfo((string) $file['name'], PATHINFO_EXTENSION);
    $safeExt = preg_replace('/[^a-zA-Z0-9]/', '', (string) $ext);
    $stored = bin2hex(random_bytes(16)) . ($safeExt ? '.' . strtolower($safeExt) : '');
    $dest = $cfg['upload_dir'] . '/' . $stored;

    if (!move_uploaded_file((string) $file['tmp_name'], $dest)) {
        flash_redirect('error', 'Upload failed.');
    }

    $mime = mime_content_type($dest) ?: ($file['type'] ?? 'application/octet-stream');
    $adminId = (int) ($_SESSION['admin_id'] ?? 0);
    if ($adminId < 1) {
        flash_redirect('error', 'Not logged in.');
    }
    $requirePassword = isset($_POST['require_password']) ? 1 : 0;
    $stmt = $pdo->prepare(
        'INSERT INTO items (admin_id, title, description, filename, original_name, mime_type, file_size, require_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $adminId,
        $title,
        $description !== '' ? $description : null,
        $stored,
        (string) $file['name'],
        $mime,
        (int) $file['size'],
        $requirePassword,
    ]);
    flash_redirect('ok', 'File uploaded.');
}

$meId = (int) ($_SESSION['admin_id'] ?? 0);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'toggle_password') {
    $id = (int) ($_POST['item_id'] ?? 0);
    if ($id > 0 && $meId > 0) {
        $stmt = $pdo->prepare('UPDATE items SET require_password = 1 - require_password WHERE id = ? AND admin_id = ?');
        $stmt->execute([$id, $meId]);
        if ($stmt->rowCount() > 0) {
            $chk = $pdo->prepare('SELECT require_password FROM items WHERE id = ? AND admin_id = ? LIMIT 1');
            $chk->execute([$id, $meId]);
            $row = $chk->fetch();
            if ($row && (int) $row['require_password'] === 1) {
                revoke_active_item_access($pdo, $id);
            }
            flash_redirect('ok', 'Permission setting updated.');
        }
    }
    flash_redirect('error', 'Could not update permission.');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'lock_all') {
    $id = (int) ($_POST['item_id'] ?? 0);
    if ($id > 0 && $meId > 0) {
        $own = $pdo->prepare('SELECT id FROM items WHERE id = ? AND admin_id = ? LIMIT 1');
        $own->execute([$id, $meId]);
        if ($own->fetch()) {
            revoke_active_item_access($pdo, $id);
            flash_redirect('ok', 'Access locked again for that file.');
        }
    }
    flash_redirect('error', 'Could not lock that file.');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'toggle') {
    $id = (int) ($_POST['item_id'] ?? 0);
    if ($id > 0 && $meId > 0) {
        $stmt = $pdo->prepare('UPDATE items SET is_active = 1 - is_active WHERE id = ? AND admin_id = ?');
        $stmt->execute([$id, $meId]);
        if ($stmt->rowCount() > 0) {
            flash_redirect('ok', 'Item visibility updated.');
        }
    }
    flash_redirect('error', 'Could not update visibility.');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete') {
    $id = (int) ($_POST['item_id'] ?? 0);
    if ($id > 0 && $meId > 0) {
        $stmt = $pdo->prepare('SELECT filename FROM items WHERE id = ? AND admin_id = ?');
        $stmt->execute([$id, $meId]);
        $row = $stmt->fetch();
        if ($row) {
            $path = $cfg['upload_dir'] . '/' . $row['filename'];
            $pdo->prepare('DELETE FROM items WHERE id = ? AND admin_id = ?')->execute([$id, $meId]);
            if (is_file($path)) {
                @unlink($path);
            }
            flash_redirect('ok', 'Item deleted.');
        }
    }
    flash_redirect('error', 'Could not delete that file.');
}

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);
$message = ($flash && ($flash['type'] ?? '') === 'ok') ? (string) $flash['text'] : '';
$error = ($flash && ($flash['type'] ?? '') === 'error') ? (string) $flash['text'] : '';

expire_stale_requests($pdo);
$itemsStmt = $pdo->prepare(
    'SELECT i.*, a.username AS uploader,
            (SELECT COUNT(*) FROM access_requests ar
             WHERE ar.item_id = i.id AND ar.status = \'unlocked\') AS unlocked_count
     FROM items i
     LEFT JOIN admins a ON a.id = i.admin_id
     WHERE i.admin_id = ?
     ORDER BY i.created_at DESC'
);
$itemsStmt->execute([$meId]);
$items = $itemsStmt->fetchAll();
$username = (string) ($_SESSION['admin_username'] ?? 'admin');
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upload — Shree's Extractions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <link rel="stylesheet" href="/Extract/assets/css/app.css?v=18" />
  <?php require __DIR__ . '/../includes/theme-head.php'; ?>
</head>
<body class="admin-body">
  <?php require __DIR__ . '/../includes/dot-cursor.php'; ?>
  <?php $navContext = 'upload'; require __DIR__ . '/../includes/nav.php'; ?>
  <header class="admin-top">
    <div>
      <h1>Upload files</h1>
    </div>
  </header>

  <main class="admin-grid">
    <section class="panel upload-panel">
      <h2>Upload file</h2>
      <p class="hint">Choose if the file needs a password, or leave it open for anyone.</p>
      <?php if ($message): ?><div class="alert ok"><?= e($message) ?></div><?php endif; ?>
      <?php if ($error): ?><div class="alert"><?= e($error) ?></div><?php endif; ?>
      <form method="post" enctype="multipart/form-data" class="upload-form">
        <input type="hidden" name="action" value="upload" />
        <label>
          <span>Title</span>
          <input type="text" name="title" maxlength="180" required placeholder="File title" />
        </label>
        <label>
          <span>Description (optional)</span>
          <textarea name="description" rows="3" placeholder="Short note for visitors"></textarea>
        </label>
        <div class="file-field">
          <span class="field-label">File</span>
          <label class="dropzone" id="dropzone" for="fileInput">
            <input id="fileInput" type="file" name="file" required />
            <span class="dropzone-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="dropzone-title">Drop a file here</span>
            <span class="dropzone-sub" id="fileName">or click to browse · max 50 MB</span>
          </label>
        </div>
        <label class="check-row">
          <input type="checkbox" name="require_password" value="1" checked />
          <span>Require password / permission to open</span>
        </label>
        <button type="submit">Upload</button>
      </form>
    </section>

    <section class="panel notif-panel" id="access-requests">
      <div class="panel-head">
        <h2>Access requests</h2>
        <div class="panel-actions">
          <button type="button" id="clearDone" class="ghost small">Clear done</button>
          <button type="button" id="markAll" class="ghost small">Mark all read</button>
        </div>
      </div>
      <p class="hint">Stay on this page — new password requests pop up here right away.</p>
      <div id="liveToast" class="live-toast" hidden role="status" aria-live="polite"></div>
      <div id="notifBell" class="notif-bell" hidden>
        <span class="pulse"></span>
        <strong id="unreadCount">0</strong> new request(s)
      </div>
      <ul id="notifList" class="notif-list"></ul>
    </section>

    <section class="panel items-panel">
      <div class="items-panel-head">
        <h2>Your files</h2>
        <p class="items-panel-hint" id="ownerFileHint" hidden></p>
      </div>
      <?php if (!$items): ?>
        <p class="empty">Nothing uploaded yet.</p>
      <?php else: ?>
        <?php
          $ownerPageSize = 4;
          $ownerChunks = array_chunk($items, $ownerPageSize);
          $ownerPages = count($ownerChunks);
          $ownerMulti = $ownerPages > 1;
          $renderOwnerRow = static function (array $item): void {
            ?>
            <article class="item-row <?= $item['is_active'] ? '' : 'off' ?>">
              <div>
                <h3><?= e($item['title']) ?></h3>
                <p>
                  by <?= e((string) ($item['uploader'] ?? 'unknown')) ?>
                  · <?= !empty($item['require_password']) ? 'Password required' : 'Open file' ?>
                  · <?= e($item['original_name']) ?>
                  · <?= e(format_bytes((int) $item['file_size'])) ?>
                </p>
              </div>
              <div class="item-actions">
                <form method="post">
                  <input type="hidden" name="action" value="toggle_password" />
                  <input type="hidden" name="item_id" value="<?= (int) $item['id'] ?>" />
                  <button type="submit" class="ghost small"><?= !empty($item['require_password']) ? 'Make open' : 'Need password' ?></button>
                </form>
                <?php if ((int) ($item['unlocked_count'] ?? 0) > 0): ?>
                <form method="post">
                  <input type="hidden" name="action" value="lock_all" />
                  <input type="hidden" name="item_id" value="<?= (int) $item['id'] ?>" />
                  <button type="submit" class="ghost small">Lock again</button>
                </form>
                <?php endif; ?>
                <?php if (empty($item['require_password'])): ?>
                <button
                  type="button"
                  class="ghost small js-copy-link"
                  data-item-id="<?= (int) $item['id'] ?>"
                  data-mime="<?= e((string) $item['mime_type']) ?>"
                >Copy link</button>
                <?php endif; ?>
                <form method="post">
                  <input type="hidden" name="action" value="toggle" />
                  <input type="hidden" name="item_id" value="<?= (int) $item['id'] ?>" />
                  <button type="submit" class="ghost small"><?= $item['is_active'] ? 'Hide' : 'Show' ?></button>
                </form>
                <form method="post" onsubmit="return confirm('Delete this file?');">
                  <input type="hidden" name="action" value="delete" />
                  <input type="hidden" name="item_id" value="<?= (int) $item['id'] ?>" />
                  <button type="submit" class="ghost small btn-delete">Delete</button>
                </form>
              </div>
            </article>
            <?php
          };
        ?>
        <div class="owner-pager" id="ownerPager" data-pages="<?= (int) $ownerPages ?>">
          <button type="button" class="owner-pager-nav owner-pager-prev" id="ownerPrev" <?= $ownerMulti ? '' : 'hidden' ?> aria-label="Previous files" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="owner-pager-viewport" id="ownerViewport">
            <div class="item-table<?= $ownerMulti ? ' is-paged' : '' ?>" id="ownerTrack">
              <?php if ($ownerMulti): ?>
                <?php foreach ($ownerChunks as $pageIdx => $chunk): ?>
                  <div class="owner-page" data-page="<?= (int) $pageIdx ?>">
                    <?php foreach ($chunk as $item) { $renderOwnerRow($item); } ?>
                  </div>
                <?php endforeach; ?>
              <?php else: ?>
                <?php foreach ($items as $item) { $renderOwnerRow($item); } ?>
              <?php endif; ?>
            </div>
          </div>
          <button type="button" class="owner-pager-nav owner-pager-next" id="ownerNext" <?= $ownerMulti ? '' : 'hidden' ?> aria-label="Next files">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="owner-pager-dots" id="ownerDots" <?= $ownerMulti ? '' : 'hidden' ?>>
          <?php if ($ownerMulti): ?>
            <?php for ($i = 0; $i < $ownerPages; $i++): ?>
              <button type="button" class="owner-dot<?= $i === 0 ? ' is-active' : '' ?>" data-page="<?= $i ?>" aria-label="Page <?= $i + 1 ?> of <?= $ownerPages ?>"></button>
            <?php endfor; ?>
          <?php endif; ?>
        </div>
      <?php endif; ?>
    </section>
  </main>

  <audio id="ping" preload="auto">
    <source src="/Extract/assets/sfx/notify.wav" type="audio/wav" />
  </audio>
  <script src="/Extract/assets/js/app.js?v=15"></script>
  <?php
    $skipFloatingTheme = true;
    require __DIR__ . '/../includes/theme-foot.php';
  ?>
</body>
</html>
