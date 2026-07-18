-- Shree's Extractions - empty schema (fresh install)
-- Import on a new server, then Register your first account in the app.
--
-- phpMyAdmin: Import this file, then Go
-- Or CLI:
--   mysql -u root -p < database/shrees_extractions.sql
--
-- DB name matches config/config.php -> db.name

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `shrees_extractions`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `shrees_extractions`;

DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `access_requests`;
DROP TABLE IF EXISTS `items`;
DROP TABLE IF EXISTS `admins`;

CREATE TABLE `admins` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `items` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `admin_id` int(10) unsigned NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` text DEFAULT NULL,
  `filename` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `mime_type` varchar(120) NOT NULL,
  `file_size` bigint(20) unsigned NOT NULL DEFAULT 0,
  `require_password` tinyint(1) NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_items_admin` (`admin_id`),
  CONSTRAINT `fk_items_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `access_requests` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int(10) unsigned NOT NULL,
  `visitor_token` varchar(64) NOT NULL,
  `requester_id` int(10) unsigned DEFAULT NULL,
  `password_plain` varchar(16) NOT NULL,
  `status` enum('pending','unlocked','expired','used') NOT NULL DEFAULT 'pending',
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `password_expires_at` datetime NOT NULL,
  `unlocked_at` datetime DEFAULT NULL,
  `unlock_expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_visitor_item` (`visitor_token`,`item_id`),
  KEY `idx_status` (`status`),
  KEY `fk_access_item` (`item_id`),
  KEY `idx_requester` (`requester_id`),
  CONSTRAINT `fk_access_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_access_requester` FOREIGN KEY (`requester_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `access_request_id` int(10) unsigned NOT NULL,
  `message` varchar(255) NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_notif_request` (`access_request_id`),
  CONSTRAINT `fk_notif_request` FOREIGN KEY (`access_request_id`) REFERENCES `access_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
