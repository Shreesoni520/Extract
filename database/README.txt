Empty database for a fresh install.

File: shrees_extractions.sql

How to use
1. Open phpMyAdmin (or MySQL CLI).
2. Import database/shrees_extractions.sql
3. Open the site and Register — that creates your first account.

Notes
- Creates DB name: shrees_extractions (same as config/config.php)
- Tables only — no users, files, or passwords
- Safe to re-import: it drops and recreates the four tables (wipes that DB)

If you rename the database, also change db.name in config/config.php
