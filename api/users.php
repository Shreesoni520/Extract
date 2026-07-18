<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';

require_admin_api();

$pdo = db();
$q = trim((string) ($_GET['q'] ?? ''));
$meId = (int) ($_SESSION['admin_id'] ?? 0);
$minLen = 2;

if ($q === '' || mb_strlen($q) < $minLen) {
    json_response([
        'ok' => true,
        'query' => $q,
        'min_length' => $minLen,
        'users' => [],
    ]);
}

$sql = 'SELECT a.id, a.username, a.avatar, a.created_at,
               (SELECT COUNT(*) FROM items i WHERE i.admin_id = a.id AND i.is_active = 1) AS file_count
        FROM admins a
        WHERE a.id != ? AND LOWER(a.username) LIKE ?';
$params = [$meId, '%' . strtolower($q) . '%'];

$sql .= ' ORDER BY a.username ASC LIMIT 40';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

json_response([
    'ok' => true,
    'query' => $q,
    'min_length' => $minLen,
    'users' => array_map(static function (array $u): array {
        $id = (int) $u['id'];
        return [
            'id' => $id,
            'username' => $u['username'],
            'avatar' => avatar_url($u['avatar'] ? (string) $u['avatar'] : null, $id),
            'file_count' => (int) $u['file_count'],
            'created_at' => $u['created_at'],
        ];
    }, $rows),
]);
