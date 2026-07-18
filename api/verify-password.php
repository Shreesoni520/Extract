<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

require_method('POST');
expire_stale_requests(db());

$body = read_json_body();
$itemId = (int) ($body['item_id'] ?? 0);
$password = strtoupper(trim((string) ($body['password'] ?? '')));

if ($itemId < 1 || $password === '') {
    json_response(['ok' => false, 'error' => 'Item and password are required'], 400);
}

$pdo = db();
$token = visitor_token();
$cfg = app_config()['app'];

$stmt = $pdo->prepare(
    "SELECT * FROM access_requests
     WHERE item_id = ? AND visitor_token = ? AND status = 'pending'
     ORDER BY id DESC LIMIT 1"
);
$stmt->execute([$itemId, $token]);
$req = $stmt->fetch();

if (!$req) {
    json_response(['ok' => false, 'error' => 'No active password request. Request access first.'], 400);
}

if (strtotime($req['password_expires_at']) < time()) {
    $pdo->prepare("UPDATE access_requests SET status = 'expired' WHERE id = ?")->execute([$req['id']]);
    json_response(['ok' => false, 'error' => 'Password expired. Request a new one.'], 410);
}

if (!hash_equals(strtoupper($req['password_plain']), $password)) {
    json_response(['ok' => false, 'error' => 'Wrong password'], 403);
}

$unlockedAt = date('Y-m-d H:i:s');
$unlockExpires = date('Y-m-d H:i:s', time() + (int) $cfg['unlock_ttl_seconds']);

$upd = $pdo->prepare(
    "UPDATE access_requests
     SET status = 'unlocked', unlocked_at = ?, unlock_expires_at = ?
     WHERE id = ?"
);
$upd->execute([$unlockedAt, $unlockExpires, $req['id']]);

json_response([
    'ok' => true,
    'status' => 'unlocked',
    'request_id' => (int) $req['id'],
    'seconds_left' => (int) $cfg['unlock_ttl_seconds'],
    'message' => 'Unlocked. You have 5 minutes — one session only.',
]);
