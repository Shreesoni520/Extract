<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_once __DIR__ . '/../config/notifications.php';

require_admin_api();

$meId = (int) ($_SESSION['admin_id'] ?? 0);
$payload = notifications_payload(db(), $meId, 0);

$active = 0;
$parts = [];
foreach ($payload['notifications'] as $n) {
    if (empty($n['is_done'])) {
        $active++;
    }
    $parts[] = $n['id'] . '-' . $n['status'] . '-' . ($n['is_read'] ? '1' : '0');
}

json_response([
    'ok' => true,
    'unread' => (int) ($payload['unread'] ?? 0),
    'active' => $active,
    'max_id' => (int) ($payload['max_id'] ?? 0),
    'fingerprint' => $payload['max_id'] . ':' . $payload['unread'] . ':' . $active . ':' . implode(',', $parts),
]);
