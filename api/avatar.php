<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$pdo = db();
$file = basename((string) ($_GET['f'] ?? ''));
$userId = (int) ($_GET['u'] ?? 0);

$path = null;
$mime = 'image/png';

if ($file !== '' && preg_match('/^[a-f0-9]+\.(jpg|jpeg|png|webp|gif)$/i', $file)) {
    $candidate = app_config()['app']['upload_dir'] . '/avatars/' . $file;
    if (is_file($candidate)) {
        $path = $candidate;
        $detected = mime_content_type($candidate);
        if (is_string($detected) && str_starts_with($detected, 'image/')) {
            $mime = $detected;
        }
    }
} elseif ($userId > 0) {
    $stmt = $pdo->prepare('SELECT avatar FROM admins WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $avatar = $stmt->fetchColumn();
    if (is_string($avatar) && $avatar !== '') {
        $candidate = app_config()['app']['upload_dir'] . '/avatars/' . basename($avatar);
        if (is_file($candidate)) {
            $path = $candidate;
            $detected = mime_content_type($candidate);
            if (is_string($detected) && str_starts_with($detected, 'image/')) {
                $mime = $detected;
            }
        }
    }
}

header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');

if ($path) {
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($path));
    readfile($path);
    exit;
}

// Simple SVG placeholder avatar
header('Content-Type: image/svg+xml; charset=utf-8');
$letter = 'U';
if ($userId > 0) {
    $stmt = $pdo->prepare('SELECT username FROM admins WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $name = (string) ($stmt->fetchColumn() ?: 'U');
    $letter = strtoupper(substr($name, 0, 1));
}
echo '<?xml version="1.0" encoding="UTF-8"?>'
    . '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
    . '<rect width="128" height="128" rx="64" fill="#111111"/>'
    . '<text x="64" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="52" font-weight="700" fill="#ffffff">'
    . htmlspecialchars($letter, ENT_QUOTES, 'UTF-8')
    . '</text></svg>';
exit;
