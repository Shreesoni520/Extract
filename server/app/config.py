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
PASSWORD_MIN_LENGTH = 8

# Vercel serverless request body limit is ~4.5 MB.
# With BLOB_READ_WRITE_TOKEN, browsers upload straight to Vercel Blob (much larger).
BLOB_READ_WRITE_TOKEN = (os.environ.get("BLOB_READ_WRITE_TOKEN") or "").strip()
BLOB_ENABLED = bool(BLOB_READ_WRITE_TOKEN)

_VERCEL_FUNCTION_MAX = 3 * 1024 * 1024  # stay under platform 4.5 MB with form overhead
_VERCEL_BLOB_MAX = 500 * 1024 * 1024  # 500 MB via client → Blob
_LOCAL_MAX = 5 * 1024 * 1024 * 1024  # 5 GB

if os.environ.get("MAX_UPLOAD_BYTES"):
    MAX_UPLOAD_BYTES = int(os.environ["MAX_UPLOAD_BYTES"])
elif ON_VERCEL and BLOB_ENABLED:
    MAX_UPLOAD_BYTES = _VERCEL_BLOB_MAX
elif ON_VERCEL:
    MAX_UPLOAD_BYTES = _VERCEL_FUNCTION_MAX
else:
    MAX_UPLOAD_BYTES = _LOCAL_MAX

# What Flask itself will accept in one request (avatars / classic form upload).
if ON_VERCEL:
    MAX_CONTENT_LENGTH = _VERCEL_FUNCTION_MAX
else:
    MAX_CONTENT_LENGTH = MAX_UPLOAD_BYTES


def max_upload_label() -> str:
    gb = MAX_UPLOAD_BYTES / (1024 * 1024 * 1024)
    if gb >= 1:
        if abs(gb - round(gb)) < 0.05:
            return f"{int(round(gb))} GB"
        return f"{gb:.1f} GB"
    mb = MAX_UPLOAD_BYTES / (1024 * 1024)
    if mb >= 1 and abs(mb - round(mb)) < 0.05:
        return f"{int(round(mb))} MB"
    if mb >= 1:
        return f"{mb:.1f} MB"
    return f"{MAX_UPLOAD_BYTES // 1024} KB"

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
