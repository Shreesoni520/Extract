<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

require_admin_api();
expire_stale_requests(db());

$itemId = (int) ($_GET['item_id'] ?? 0);
if ($itemId < 1) {
    json_response(['ok' => false, 'error' => 'item_id required'], 400);
}

$pdo = db();
$token = visitor_token();

$itemStmt = $pdo->prepare(
    'SELECT id, require_password, mime_type, is_active
     FROM items WHERE id = ? LIMIT 1'
);
$itemStmt->execute([$itemId]);
$item = $itemStmt->fetch();

if (!$item || !(int) $item['is_active']) {
    json_response(['ok' => true, 'status' => 'missing']);
}

if (!(int) $item['require_password']) {
    json_response([
        'ok' => true,
        'status' => 'open',
        'can_preview' => is_previewable($item['mime_type']),
    ]);
}

$reqStmt = $pdo->prepare(
    "SELECT id, status, password_expires_at, unlock_expires_at
     FROM access_requests
     WHERE visitor_token = ? AND item_id = ? AND status IN ('pending', 'unlocked')
     ORDER BY id DESC LIMIT 1"
);
$reqStmt->execute([$token, $itemId]);
$req = $reqStmt->fetch();

if (!$req) {
    json_response(['ok' => true, 'status' => 'locked']);
}

if ($req['status'] === 'pending') {
    json_response([
        'ok' => true,
        'status' => 'pending',
        'request_id' => (int) $req['id'],
        'seconds_left' => max(0, strtotime($req['password_expires_at']) - time()),
    ]);
}

$left = max(0, strtotime((string) $req['unlock_expires_at']) - time());
if ($left < 1) {
    $pdo->prepare("UPDATE access_requests SET status = 'used' WHERE id = ?")->execute([(int) $req['id']]);
    json_response(['ok' => true, 'status' => 'locked']);
}

json_response([
    'ok' => true,
    'status' => 'unlocked',
    'request_id' => (int) $req['id'],
    'seconds_left' => $left,
    'can_preview' => is_previewable($item['mime_type']),
]);
