<?php
declare(strict_types=1);

/**
 * Build the access-request notification payload for the current owner.
 *
 * @return array{ok:bool,unread:int,done_count:int,notifications:list<array>,max_id:int}
 */
function notifications_payload(PDO $pdo, int $ownerId, int $sinceId = 0): array
{
    expire_stale_requests($pdo);

    $unreadStmt = $pdo->prepare(
        "SELECT COUNT(*)
         FROM notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         WHERE n.is_read = 0 AND ar.status IN ('pending', 'unlocked') AND i.admin_id = ?"
    );
    $unreadStmt->execute([$ownerId]);
    $unread = (int) $unreadStmt->fetchColumn();

    $doneStmt = $pdo->prepare(
        "SELECT COUNT(*)
         FROM notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         WHERE ar.status IN ('used', 'expired') AND i.admin_id = ?"
    );
    $doneStmt->execute([$ownerId]);
    $doneCount = (int) $doneStmt->fetchColumn();

    $sql = 'SELECT n.id, n.message, n.is_read, n.created_at, n.access_request_id,
                   ar.password_plain, ar.status, ar.password_expires_at, ar.unlock_expires_at,
                   ar.requester_id,
                   i.title AS item_title, i.id AS item_id,
                   req.username AS requester_username, req.avatar AS requester_avatar
            FROM notifications n
            JOIN access_requests ar ON ar.id = n.access_request_id
            JOIN items i ON i.id = ar.item_id
            LEFT JOIN admins req ON req.id = ar.requester_id
            WHERE i.admin_id = ?';
    $params = [$ownerId];
    if ($sinceId > 0) {
        $sql .= ' AND n.id > ?';
        $params[] = $sinceId;
    }
    $sql .= ' ORDER BY
                CASE ar.status
                  WHEN \'pending\' THEN 0
                  WHEN \'unlocked\' THEN 1
                  ELSE 2
                END,
                n.id DESC
              LIMIT 40';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $notifications = array_map(static function (array $n): array {
        $isDone = in_array($n['status'], ['used', 'expired'], true);
        $pwdLeft = null;
        if ($n['status'] === 'pending') {
            $pwdLeft = max(0, strtotime($n['password_expires_at']) - time());
        }
        $unlockLeft = null;
        if ($n['status'] === 'unlocked' && $n['unlock_expires_at']) {
            $unlockLeft = max(0, strtotime((string) $n['unlock_expires_at']) - time());
        }
        $requesterId = (int) ($n['requester_id'] ?? 0);
        $requesterUsername = trim((string) ($n['requester_username'] ?? ''));
        return [
            'id' => (int) $n['id'],
            'request_id' => (int) $n['access_request_id'],
            'message' => $n['message'],
            'is_read' => (bool) $n['is_read'],
            'created_at' => $n['created_at'],
            'password' => $n['password_plain'],
            'status' => $n['status'],
            'is_done' => $isDone,
            'item_title' => $n['item_title'],
            'item_id' => (int) $n['item_id'],
            'password_seconds_left' => $pwdLeft,
            'unlock_seconds_left' => $unlockLeft,
            'can_lock' => $n['status'] === 'unlocked',
            'requester' => [
                'id' => $requesterId,
                'username' => $requesterUsername !== '' ? $requesterUsername : null,
                'avatar' => avatar_url(
                    $n['requester_avatar'] ? (string) $n['requester_avatar'] : null,
                    $requesterId
                ),
            ],
        ];
    }, $rows);

    $maxId = 0;
    foreach ($notifications as $n) {
        $maxId = max($maxId, (int) $n['id']);
    }

    return [
        'ok' => true,
        'unread' => $unread,
        'done_count' => $doneCount,
        'notifications' => $notifications,
        'max_id' => $maxId,
    ];
}
