<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_admin_api();
require_method('POST');

$body = read_json_body();
$markAll = !empty($body['all']);
$id = (int) ($body['id'] ?? 0);
$meId = (int) ($_SESSION['admin_id'] ?? 0);

$pdo = db();
if ($markAll) {
    $stmt = $pdo->prepare(
        'UPDATE notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         SET n.is_read = 1
         WHERE n.is_read = 0 AND i.admin_id = ?'
    );
    $stmt->execute([$meId]);
} elseif ($id > 0) {
    $stmt = $pdo->prepare(
        'UPDATE notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         SET n.is_read = 1
         WHERE n.id = ? AND i.admin_id = ?'
    );
    $stmt->execute([$id, $meId]);
} else {
    json_response(['ok' => false, 'error' => 'Nothing to mark'], 400);
}

json_response(['ok' => true]);
