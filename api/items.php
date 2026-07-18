<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

require_admin_api();
expire_stale_requests(db());
$token = visitor_token();
$pdo = db();

$userId = (int) ($_GET['user_id'] ?? 0);
if ($userId < 1) {
    json_response(['ok' => false, 'error' => 'user_id required'], 400);
}

$sql = 'SELECT i.id, i.title, i.description, i.mime_type, i.file_size, i.original_name, i.created_at,
               i.require_password, a.username AS uploader, a.id AS uploader_id, a.avatar
        FROM items i
        LEFT JOIN admins a ON a.id = i.admin_id
        WHERE i.is_active = 1 AND i.admin_id = ?
        ORDER BY i.created_at DESC';
$params = [$userId];

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$items = $stmt->fetchAll();

$states = [];
if ($items) {
    $reqStmt = $pdo->prepare(
        "SELECT id, item_id, status, password_expires_at, unlock_expires_at
         FROM access_requests
         WHERE visitor_token = ? AND item_id = ? AND status IN ('pending','unlocked')
         ORDER BY id DESC LIMIT 1"
    );
    foreach ($items as $item) {
        $id = (int) $item['id'];
        if (!(int) $item['require_password']) {
            $states[$id] = [
                'status' => 'open',
                'can_preview' => is_previewable($item['mime_type']),
            ];
            continue;
        }
        $reqStmt->execute([$token, $id]);
        $req = $reqStmt->fetch();
        if (!$req) {
            $states[$id] = ['status' => 'locked'];
            continue;
        }
        if ($req['status'] === 'pending') {
            $states[$id] = [
                'status' => 'pending',
                'request_id' => (int) $req['id'],
                'seconds_left' => max(0, strtotime($req['password_expires_at']) - time()),
            ];
        } else {
            $states[$id] = [
                'status' => 'unlocked',
                'request_id' => (int) $req['id'],
                'seconds_left' => max(0, strtotime((string) $req['unlock_expires_at']) - time()),
                'can_preview' => is_previewable($item['mime_type']),
            ];
        }
    }
}

json_response([
    'ok' => true,
    'user_id' => $userId,
    'items' => array_map(static function (array $item) use ($states): array {
        $state = $states[$item['id']] ?? ['status' => 'locked'];
        $uid = (int) ($item['uploader_id'] ?? 0);
        return [
            'id' => (int) $item['id'],
            'title' => $item['title'],
            'description' => $item['description'],
            'uploader' => $item['uploader'] ?: 'unknown',
            'uploader_id' => $uid,
            'uploader_avatar' => avatar_url($item['avatar'] ? (string) $item['avatar'] : null, $uid),
            'require_password' => (bool) $item['require_password'],
            'mime_type' => $item['mime_type'],
            'file_size' => format_bytes((int) $item['file_size']),
            'original_name' => $item['original_name'],
            'created_at' => $item['created_at'],
            'access' => $state,
        ];
    }, $items),
]);
