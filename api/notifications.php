<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/auth.php';
require_once __DIR__ . '/../config/notifications.php';

require_admin_api();

$pdo = db();
$sinceId = (int) ($_GET['since_id'] ?? 0);
$meId = (int) ($_SESSION['admin_id'] ?? 0);

json_response(notifications_payload($pdo, $meId, $sinceId));
