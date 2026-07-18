<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

expire_stale_requests(db());

$itemId = (int) ($_GET['item_id'] ?? 0);
$mode = ($_GET['mode'] ?? 'download') === 'view' ? 'view' : 'download';
$appName = app_config()['app']['name'];

function locked_page(string $title, string $message, int $status = 403): void
{
    $appName = app_config()['app']['name'];
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    ?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= e($title) ?> — <?= e($appName) ?></title>
  <?php require __DIR__ . '/../includes/favicon.php'; ?>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <style>
    :root {
      --bg: #f6f7f8;
      --ink: #111111;
      --muted: #6b7280;
      --line: #e5e7eb;
      --surface: #ffffff;
      --font: "Figtree", system-ui, sans-serif;
      --display: "Sora", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      font-family: var(--font);
      color: var(--ink);
      background:
        radial-gradient(800px 420px at 80% 0%, rgba(17, 17, 17, 0.04), transparent 55%),
        linear-gradient(180deg, #fafafa 0%, #f4f5f6 100%);
    }
    .card {
      width: min(420px, 100%);
      padding: 2rem 1.6rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 1px 2px rgba(17, 17, 17, 0.04), 0 12px 28px rgba(17, 17, 17, 0.06);
      text-align: center;
    }
    .icon {
      width: 52px;
      height: 52px;
      margin: 0 auto 1rem;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: #f3f4f6;
      border: 1px solid var(--line);
      color: var(--ink);
    }
    h1 {
      margin: 0 0 0.5rem;
      font-family: var(--display);
      font-size: 1.55rem;
      letter-spacing: -0.03em;
    }
    p {
      margin: 0 0 1.4rem;
      color: var(--muted);
      line-height: 1.55;
      font-size: 0.98rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem 1.25rem;
      border-radius: 10px;
      background: #111111;
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      transition: background 0.2s ease, transform 0.2s ease;
    }
    .btn:hover {
      background: #000;
      transform: translateY(-1px);
    }
    .brand {
      margin: 1.25rem 0 0;
      font-size: 0.82rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <?php require __DIR__ . '/../includes/dot-cursor.php'; ?>
  <div class="card">
    <div class="icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <rect x="5" y="11" width="14" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/>
      </svg>
    </div>
    <h1><?= e($title) ?></h1>
    <p><?= e($message) ?></p>
    <a class="btn" href="/Extract/">Go to home</a>
    <p class="brand"><?= e($appName) ?></p>
  </div>
</body>
</html>
    <?php
    exit;
}

if ($itemId < 1) {
    locked_page(
        'Something went wrong',
        'This file link is not valid. Go back home and choose a file again.',
        400
    );
}

$pdo = db();
$token = visitor_token();

// Open files (no password required)
$openStmt = $pdo->prepare(
    'SELECT filename, original_name, mime_type, title, require_password
     FROM items WHERE id = ? AND is_active = 1 LIMIT 1'
);
$openStmt->execute([$itemId]);
$item = $openStmt->fetch();

if (!$item) {
    locked_page(
        'File unavailable',
        'This file could not be found. Please go home and try another file.',
        404
    );
}

$serveFile = static function (array $row, string $mode): void {
    $path = app_config()['app']['upload_dir'] . '/' . $row['filename'];
    if (!is_file($path)) {
        locked_page(
            'File unavailable',
            'This file could not be found. Please go home and try another file.',
            404
        );
    }
    $mime = $row['mime_type'] ?: 'application/octet-stream';
    $filename = $row['original_name'];
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($path));
    if ($mode === 'view' && is_previewable($mime)) {
        header('Content-Disposition: inline; filename="' . rawurlencode($filename) . '"');
    } else {
        header('Content-Disposition: attachment; filename="' . rawurlencode($filename) . '"');
    }
    readfile($path);
    exit;
};

if (!(int) $item['require_password']) {
    $serveFile($item, $mode);
}

$stmt = $pdo->prepare(
    "SELECT ar.*, i.filename, i.original_name, i.mime_type, i.title, i.is_active, i.require_password
     FROM access_requests ar
     JOIN items i ON i.id = ar.item_id
     WHERE ar.item_id = ? AND ar.visitor_token = ? AND ar.status = 'unlocked'
     ORDER BY ar.id DESC LIMIT 1"
);
$stmt->execute([$itemId, $token]);
$access = $stmt->fetch();

$stillValid = $access
    && (int) $access['is_active'] === 1
    && (int) $access['require_password'] === 1
    && strtotime((string) $access['unlock_expires_at']) >= time();

if (!$stillValid) {
    if ($access) {
        $pdo->prepare(
            "UPDATE access_requests
             SET status = 'used', unlock_expires_at = LEAST(COALESCE(unlock_expires_at, NOW()), NOW())
             WHERE id = ?"
        )->execute([$access['id']]);
    }
    locked_page(
        'Access locked',
        'This file is locked again. Request a new password from the home page to open it.',
        403
    );
}

$serveFile($access, $mode);
