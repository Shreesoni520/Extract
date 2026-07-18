<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

require_method('POST');
require_admin_api();
expire_stale_requests(db());

$body = read_json_body();
$itemId = (int) ($body['item_id'] ?? 0);
if ($itemId < 1) {
    json_response(['ok' => false, 'error' => 'Invalid item'], 400);
}

$pdo = db();
$stmt = $pdo->prepare('SELECT id, title, require_password FROM items WHERE id = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$itemId]);
$item = $stmt->fetch();
if (!$item) {
    json_response(['ok' => false, 'error' => 'Item not found'], 404);
}
if (!(int) $item['require_password']) {
    json_response(['ok' => false, 'error' => 'This file is open — no password needed'], 400);
}

$token = visitor_token();
$requesterId = (int) ($_SESSION['admin_id'] ?? 0);
$requesterName = trim((string) ($_SESSION['admin_username'] ?? ''));
$cfg = app_config()['app'];

$check = $pdo->prepare(
    "SELECT id, status, password_expires_at, unlock_expires_at
     FROM access_requests
     WHERE item_id = ? AND visitor_token = ? AND status IN ('pending','unlocked')
     ORDER BY id DESC LIMIT 1"
);
$check->execute([$itemId, $token]);
$existing = $check->fetch();

if ($existing) {
    if ($existing['status'] === 'pending') {
        $ttl = max(0, strtotime($existing['password_expires_at']) - time());
        json_response([
            'ok' => true,
            'status' => 'pending',
            'request_id' => (int) $existing['id'],
            'seconds_left' => $ttl,
            'message' => 'Password already requested. Enter it within the time window.',
        ]);
    }
    if ($existing['status'] === 'unlocked') {
        $ttl = max(0, strtotime((string) $existing['unlock_expires_at']) - time());
        json_response([
            'ok' => true,
            'status' => 'unlocked',
            'request_id' => (int) $existing['id'],
            'seconds_left' => $ttl,
            'message' => 'You already have active access.',
        ]);
    }
}

$password = generate_password(6);
$passwordExpires = date('Y-m-d H:i:s', time() + (int) $cfg['password_ttl_seconds']);

$pdo->beginTransaction();
try {
    try {
        $ins = $pdo->prepare(
            'INSERT INTO access_requests (item_id, visitor_token, requester_id, password_plain, status, password_expires_at)
             VALUES (?, ?, ?, ?, \'pending\', ?)'
        );
        $ins->execute([
            $itemId,
            $token,
            $requesterId > 0 ? $requesterId : null,
            $password,
            $passwordExpires,
        ]);
    } catch (Throwable $e) {
        $ins = $pdo->prepare(
            'INSERT INTO access_requests (item_id, visitor_token, password_plain, status, password_expires_at)
             VALUES (?, ?, ?, \'pending\', ?)'
        );
        $ins->execute([$itemId, $token, $password, $passwordExpires]);
    }
    $requestId = (int) $pdo->lastInsertId();

    $who = $requesterName !== '' ? '@' . $requesterName : 'Someone';
    $msg = $who . ' requested access to "' . $item['title'] . '" — password: ' . $password;
    $n = $pdo->prepare('INSERT INTO notifications (access_request_id, message) VALUES (?, ?)');
    $n->execute([$requestId, $msg]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_response(['ok' => false, 'error' => 'Could not create request'], 500);
}

json_response([
    'ok' => true,
    'status' => 'pending',
    'request_id' => $requestId,
    'seconds_left' => (int) $cfg['password_ttl_seconds'],
    'message' => 'Request sent. Enter the password within 5 minutes once you receive it.',
]);
