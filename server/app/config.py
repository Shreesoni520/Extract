"""Application configuration — mirrors PHP config/config.php."""
from pathlib import Path

# Project root = parent of server/ (the "Shree's Extractions" folder)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = (PROJECT_ROOT / "uploads").resolve()
ASSETS_DIR = (PROJECT_ROOT / "assets").resolve()

DB_HOST = "127.0.0.1"
DB_NAME = "shrees_extractions"
DB_USER = "root"
DB_PASS = ""
DB_CHARSET = "utf8mb4"

APP_NAME = "Shree's Extractions"
PASSWORD_TTL_SECONDS = 300  # 5 minutes to enter password
UNLOCK_TTL_SECONDS = 300  # 5 minutes of access
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
PASSWORD_MIN_LENGTH = 8

# Flask session secret — change in production
SECRET_KEY = "shrees-extractions-dev-secret-change-me"

# URL prefix matching Apache/XAMPP alias
URL_PREFIX = "/Extract"
