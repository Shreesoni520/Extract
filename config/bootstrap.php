<?php
declare(strict_types=1);

function app_config(): array
{
    static $config;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $c = app_config()['db'];
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        $c['host'],
        $c['name'],
        $c['charset']
    );

    $pdo = new PDO($dsn, $c['user'], $c['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    ensure_schema($pdo);

    return $pdo;
}

/** Add newer columns on older databases without a full re-import. */
function ensure_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $cols = $pdo->query('SHOW COLUMNS FROM admins LIKE \'avatar\'')->fetch();
        if (!$cols) {
            $pdo->exec('ALTER TABLE admins ADD COLUMN avatar VARCHAR(255) NULL AFTER password_hash');
        }
        $cols = $pdo->query('SHOW COLUMNS FROM items LIKE \'require_password\'')->fetch();
        if (!$cols) {
            $pdo->exec('ALTER TABLE items ADD COLUMN require_password TINYINT(1) NOT NULL DEFAULT 1 AFTER file_size');
        }
        $cols = $pdo->query('SHOW COLUMNS FROM access_requests LIKE \'requester_id\'')->fetch();
        if (!$cols) {
            try {
                $pdo->exec(
                    'ALTER TABLE access_requests
                     ADD COLUMN requester_id INT UNSIGNED NULL AFTER visitor_token'
                );
            } catch (Throwable $e) {
                // ignore
            }
            try {
                $pdo->exec('ALTER TABLE access_requests ADD KEY idx_requester (requester_id)');
            } catch (Throwable $e) {
                // ignore
            }
            try {
                $pdo->exec(
                    'ALTER TABLE access_requests
                     ADD CONSTRAINT fk_access_requester
                     FOREIGN KEY (requester_id) REFERENCES admins (id) ON DELETE SET NULL'
                );
            } catch (Throwable $e) {
                // FK optional — column alone is enough
            }
        }
    } catch (Throwable $e) {
        // Schema ensure is best-effort; setup/import still works.
    }
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function require_method(string $method): void
{
    if (strcasecmp($_SERVER['REQUEST_METHOD'] ?? 'GET', $method) !== 0) {
        json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
    }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function generate_password(int $length = 6): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $out = '';
    $max = strlen($alphabet) - 1;
    for ($i = 0; $i < $length; $i++) {
        $out .= $alphabet[random_int(0, $max)];
    }
    return $out;
}

function visitor_token(): string
{
    if (empty($_COOKIE['se_visitor'])) {
        $token = bin2hex(random_bytes(16));
        setcookie('se_visitor', $token, [
            'expires' => time() + 60 * 60 * 24 * 365,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $_COOKIE['se_visitor'] = $token;
        return $token;
    }
    return (string) $_COOKIE['se_visitor'];
}

function format_bytes(int $bytes): string
{
    $units = ['B', 'KB', 'MB', 'GB'];
    $i = 0;
    $n = (float) $bytes;
    while ($n >= 1024 && $i < count($units) - 1) {
        $n /= 1024;
        $i++;
    }
    return round($n, 1) . ' ' . $units[$i];
}

function is_previewable(string $mime): bool
{
    return str_starts_with($mime, 'image/')
        || str_starts_with($mime, 'video/')
        || str_starts_with($mime, 'audio/')
        || $mime === 'application/pdf'
        || str_starts_with($mime, 'text/');
}

function ensure_upload_dir(): string
{
    $dir = app_config()['app']['upload_dir'];
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $htaccess = $dir . '/.htaccess';
    if (!is_file($htaccess)) {
        file_put_contents($htaccess, "Require all denied\n");
    }
    $avatars = $dir . '/avatars';
    if (!is_dir($avatars)) {
        mkdir($avatars, 0755, true);
    }
    $avHt = $avatars . '/.htaccess';
    if (!is_file($avHt)) {
        file_put_contents($avHt, "Require all denied\n");
    }
    return $dir;
}

function avatar_url(?string $filename, int $userId = 0): string
{
    if ($filename) {
        return '/Extract/api/avatar.php?f=' . rawurlencode($filename);
    }
    return '/Extract/api/avatar.php?u=' . $userId;
}

function expire_stale_requests(PDO $pdo): void
{
    $now = date('Y-m-d H:i:s');

    $pdo->prepare(
        "UPDATE access_requests
         SET status = 'expired'
         WHERE status = 'pending' AND password_expires_at < ?"
    )->execute([$now]);

    $pdo->prepare(
        "UPDATE access_requests
         SET status = 'used'
         WHERE status = 'unlocked' AND unlock_expires_at < ?"
    )->execute([$now]);
}

/** End active pending/unlocked sessions for a file (owner locked it again). */
function revoke_active_item_access(PDO $pdo, int $itemId): int
{
    if ($itemId < 1) {
        return 0;
    }
    $now = date('Y-m-d H:i:s');
    $stmt = $pdo->prepare(
        "UPDATE access_requests
         SET status = 'used',
             unlock_expires_at = ?,
             password_expires_at = LEAST(password_expires_at, ?)
         WHERE item_id = ? AND status IN ('pending', 'unlocked')"
    );
    $stmt->execute([$now, $now, $itemId]);

    return $stmt->rowCount();
}

/** Remove finished (used/expired) access requests + their notifications from the list. */
function clear_done_access_requests(PDO $pdo, ?int $notificationId = null): int
{
    expire_stale_requests($pdo);

    if ($notificationId !== null && $notificationId > 0) {
        $stmt = $pdo->prepare(
            "SELECT ar.id
             FROM notifications n
             JOIN access_requests ar ON ar.id = n.access_request_id
             WHERE n.id = ? AND ar.status IN ('used', 'expired')
             LIMIT 1"
        );
        $stmt->execute([$notificationId]);
        $requestId = $stmt->fetchColumn();
        if (!$requestId) {
            return 0;
        }
        $del = $pdo->prepare('DELETE FROM access_requests WHERE id = ?');
        $del->execute([(int) $requestId]);
        return $del->rowCount();
    }

    // CASCADE deletes related notifications
    return (int) $pdo->exec(
        "DELETE FROM access_requests WHERE status IN ('used', 'expired')"
    );
}
