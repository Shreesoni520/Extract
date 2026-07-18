<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin_api();
require_method('POST');

$body = read_json_body();
$all = !empty($body['all']);
$notificationId = (int) ($body['notification_id'] ?? 0);

$pdo = db();

if ($all) {
    $cleared = clear_done_access_requests($pdo);
    json_response(['ok' => true, 'cleared' => $cleared, 'message' => 'Done requests cleared']);
}

if ($notificationId > 0) {
    $cleared = clear_done_access_requests($pdo, $notificationId);
    if ($cleared < 1) {
        json_response(['ok' => false, 'error' => 'Nothing to clear'], 400);
    }
    json_response(['ok' => true, 'cleared' => $cleared]);
}

json_response(['ok' => false, 'error' => 'Specify all or notification_id'], 400);
