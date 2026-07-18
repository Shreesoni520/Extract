<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

const PASSWORD_MIN_LENGTH = 8;

function start_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Lax',
        ]);
    }
}

function admin_logged_in(): bool
{
    start_session();
    $id = (int) ($_SESSION['admin_id'] ?? 0);
    if ($id < 1) {
        return false;
    }

    static $ok = null;
    if ($ok !== null) {
        return $ok;
    }

    $stmt = db()->prepare('SELECT id, username FROM admins WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        logout_admin();
        $ok = false;
        return false;
    }

    $_SESSION['admin_username'] = (string) $row['username'];
    $ok = true;
    return true;
}

function require_admin(): void
{
    if (!admin_logged_in()) {
        header('Location: /Extract/app/login.php');
        exit;
    }
}

function require_admin_api(): void
{
    if (!admin_logged_in()) {
        json_response(['ok' => false, 'error' => 'Unauthorized'], 401);
    }
}

function after_login_redirect(): void
{
    header('Location: /Extract/');
    exit;
}

/**
 * @return array{0:?string,1:?string} [normalized username, error message]
 */
function parse_username(string $raw): array
{
    $user = strtolower(trim($raw));
    if ($user === '') {
        return [null, 'Enter a username.'];
    }
    if (strlen($user) < 3) {
        return [null, 'Username must be at least 3 characters.'];
    }
    if (strlen($user) > 32) {
        return [null, 'Username must be 32 characters or fewer.'];
    }
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/', $user)) {
        return [null, 'Use 3–32 characters: lowercase letters, numbers, and you can use dots, underscores, or hyphens. Must start with a letter or number.'];
    }
    if (preg_match('/(\.\.|__|--)/', $user)) {
        return [null, 'Username cannot use repeated dots, underscores, or hyphens.'];
    }

    return [$user, null];
}

function username_taken(string $normalized, ?int $exceptId = null): bool
{
    $sql = 'SELECT id FROM admins WHERE LOWER(username) = ?';
    $params = [$normalized];
    if ($exceptId !== null) {
        $sql .= ' AND id != ?';
        $params[] = $exceptId;
    }
    $stmt = db()->prepare($sql . ' LIMIT 1');
    $stmt->execute($params);

    return (bool) $stmt->fetch();
}

/** Exact match, or same name with only trailing dots (shree vs shree.). */
function username_collides(string $raw, ?int $exceptId = null): bool
{
    $lower = strtolower(trim($raw));
    if ($lower === '' || strlen($lower) < 3) {
        return false;
    }

    if (username_taken($lower, $exceptId)) {
        return true;
    }

    $sql = 'SELECT username FROM admins';
    $params = [];
    if ($exceptId !== null) {
        $sql .= ' WHERE id != ?';
        $params[] = $exceptId;
    }
    $stmt = db()->prepare($sql);
    $stmt->execute($params);

    foreach ($stmt->fetchAll() as $row) {
        if (username_dot_variant_collision($lower, (string) $row['username'])) {
            return true;
        }
    }

    return false;
}

function username_dot_variant_collision(string $attempt, string $existing): bool
{
    $attempt = strtolower(trim($attempt));
    $existing = strtolower(trim($existing));
    if ($attempt === $existing) {
        return true;
    }

    $attemptBase = rtrim($attempt, '.');
    $existingBase = rtrim($existing, '.');
    if (strlen($attemptBase) < 3 || $attemptBase !== $existingBase) {
        return false;
    }

    return $attempt !== $attemptBase || $existing !== $existingBase;
}

function username_taken_message(): string
{
    $lines = [
        'That username is already taken.',
        'Someone already uses that name — try another.',
        'This username is not available.',
        'That name is taken. Pick a different one.',
        'Already in use. Choose another username.',
        'Nope — that username belongs to someone else.',
    ];

    return $lines[random_int(0, count($lines) - 1)];
}

function attempt_login(string $username, string $password): bool
{
    [$user, $error] = parse_username($username);
    if ($error !== null) {
        // Allow older accounts created before stricter username rules.
        $user = strtolower(trim($username));
        if ($user === '') {
            return false;
        }
    }

    $stmt = db()->prepare('SELECT id, username, password_hash FROM admins WHERE LOWER(username) = ? LIMIT 1');
    $stmt->execute([$user]);
    $admin = $stmt->fetch();
    if (!$admin || !password_verify($password, $admin['password_hash'])) {
        return false;
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['admin_id'] = (int) $admin['id'];
    $_SESSION['admin_username'] = (string) $admin['username'];
    return true;
}

function admin_count(): int
{
    return (int) db()->query('SELECT COUNT(*) FROM admins')->fetchColumn();
}

function create_admin(string $username, string $password): bool
{
    [$user, $error] = parse_username($username);
    if ($error !== null || strlen($password) < PASSWORD_MIN_LENGTH || username_collides($user)) {
        return false;
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = db()->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)');
    $stmt->execute([$user, $hash]);
    return true;
}

function logout_admin(): void
{
    start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}
