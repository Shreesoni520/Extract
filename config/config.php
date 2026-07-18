<?php
declare(strict_types=1);

return [
    'db' => [
        'host' => '127.0.0.1',
        'name' => 'shrees_extractions',
        'user' => 'root',
        'pass' => '',
        'charset' => 'utf8mb4',
    ],
    'app' => [
        'name' => "Shree's Extractions",
        'password_ttl_seconds' => 300,   // 5 minutes to enter password
        'unlock_ttl_seconds' => 300,     // 5 minutes of access
        'upload_dir' => __DIR__ . '/../uploads',
        'max_upload_bytes' => 50 * 1024 * 1024, // 50 MB
        // Email alerts (wire up later)
        'notify_email' => null,
    ],
];
