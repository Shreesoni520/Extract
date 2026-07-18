<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin_api();
require_method('POST');

$body = read_json_body();
$requestId = (int) ($body['request_id'] ?? 0);
$itemId = (int) ($body['item_id'] ?? 0);
$meId = (int) ($_SESSION['admin_id'] ?? 0);

$pdo = db();

// Lock again from a notification: end EVERY active session for that file.
if ($requestId > 0) {
    $find = $pdo->prepare(
        'SELECT ar.item_id
         FROM access_requests ar
         JOIN items i ON i.id = ar.item_id
         WHERE ar.id = ? AND i.admin_id = ?
         LIMIT 1'
    );
    $find->execute([$requestId, $meId]);
    $row = $find->fetch();
    if (!$row) {
        json_response(['ok' => false, 'error' => 'Nothing to lock'], 400);
    }
    $itemId = (int) $row['item_id'];
    $locked = revoke_active_item_access($pdo, $itemId);
    if ($locked < 1) {
        // Already locked — still ok so the owner UI can refresh.
        json_response(['ok' => true, 'message' => 'Already locked', 'item_id' => $itemId, 'locked' => 0]);
    }
    json_response([
        'ok' => true,
        'message' => 'Access locked again',
        'item_id' => $itemId,
        'locked' => $locked,
    ]);
}

if ($itemId > 0) {
    $own = $pdo->prepare('SELECT id FROM items WHERE id = ? AND admin_id = ? LIMIT 1');
    $own->execute([$itemId, $meId]);
    if (!$own->fetch()) {
        json_response(['ok' => false, 'error' => 'Not allowed'], 403);
    }
    $locked = revoke_active_item_access($pdo, $itemId);
    json_response([
        'ok' => true,
        'message' => 'All active access for this file is locked',
        'item_id' => $itemId,
        'locked' => $locked,
    ]);
}

json_response(['ok' => false, 'error' => 'request_id or item_id required'], 400);
