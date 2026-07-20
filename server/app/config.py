"""Application configuration — env-aware for local + Vercel."""
from __future__ import annotations

import os
from pathlib import Path

# Project root = parent of server/ (the repo root)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

ON_VERCEL = os.environ.get("VERCEL") == "1"

# Keep /Extract so existing JS/CSS paths keep working on Vercel too
URL_PREFIX = os.environ.get("URL_PREFIX", "/Extract")

APP_NAME = "Shree's Extractions"
PASSWORD_TTL_SECONDS = int(os.environ.get("PASSWORD_TTL_SECONDS", "300"))
UNLOCK_TTL_SECONDS = int(os.environ.get("UNLOCK_TTL_SECONDS", "300"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
PASSWORD_MIN_LENGTH = 8

SECRET_KEY = os.environ.get("SECRET_KEY", "shrees-extractions-dev-secret-change-me")

# On Vercel use SQLite in /tmp unless USE_SQLITE=0 and MySQL env is set
_default_sqlite = "1" if ON_VERCEL else "0"
USE_SQLITE = os.environ.get("USE_SQLITE", _default_sqlite) == "1"

DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_NAME = os.environ.get("DB_NAME", "shrees_extractions")
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASS", "")
DB_CHARSET = "utf8mb4"

if ON_VERCEL:
    UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/tmp/shrees_uploads")).resolve()
    SQLITE_PATH = Path(os.environ.get("SQLITE_PATH", "/tmp/shrees_extractions.db")).resolve()
    ASSETS_DIR = (PROJECT_ROOT / "assets").resolve()
else:
    UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(PROJECT_ROOT / "uploads"))).resolve()
    SQLITE_PATH = Path(
        os.environ.get("SQLITE_PATH", str(PROJECT_ROOT / "database" / "local.db"))
    ).resolve()
    ASSETS_DIR = (PROJECT_ROOT / "assets").resolve()
