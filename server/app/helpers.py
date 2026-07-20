"""Shared helpers — mirrors PHP config/bootstrap.php utilities."""
from __future__ import annotations

import mimetypes
import os
import re
import secrets
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from flask import current_app, make_response, jsonify, request

from . import config as cfg
from .db import get_db


def json_response(payload: dict, status: int = 200):
    resp = make_response(jsonify(payload), status)
    resp.headers["Content-Type"] = "application/json; charset=utf-8"
    return resp


def require_method(method: str):
    if request.method.upper() != method.upper():
        return json_response({"ok": False, "error": "Method not allowed"}, 405)
    return None


def read_json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def generate_password(length: int = 6) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def format_bytes(num_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    i = 0
    n = float(num_bytes)
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{round(n, 1)} {units[i]}"


def is_previewable(mime: str) -> bool:
    mime = mime or ""
    return (
        mime.startswith("image/")
        or mime.startswith("video/")
        or mime.startswith("audio/")
        or mime == "application/pdf"
        or mime.startswith("text/")
    )


def ensure_upload_dir() -> Path:
    upload_dir = Path(cfg.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    htaccess = upload_dir / ".htaccess"
    if not htaccess.is_file():
        htaccess.write_text("Require all denied\n", encoding="utf-8")
    avatars = upload_dir / "avatars"
    avatars.mkdir(parents=True, exist_ok=True)
    av_ht = avatars / ".htaccess"
    if not av_ht.is_file():
        av_ht.write_text("Require all denied\n", encoding="utf-8")
    return upload_dir


def avatar_url(filename: str | None, user_id: int = 0) -> str:
    prefix = cfg.URL_PREFIX
    if filename:
        return f"{prefix}/api/avatar.php?f={quote(filename)}"
    return f"{prefix}/api/avatar.php?u={user_id}"


def now_sql() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def sql_datetime(ts: float | None = None) -> str:
    if ts is None:
        return now_sql()
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def parse_sql_datetime(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.timestamp()
    s = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            continue
    return None


def seconds_left(expires_at) -> int:
    ts = parse_sql_datetime(expires_at)
    if ts is None:
        return 0
    return max(0, int(ts - datetime.now().timestamp()))


def detect_mime(path: Path, fallback: str = "application/octet-stream") -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    if guessed:
        return guessed
    return fallback


def expire_stale_requests(conn=None) -> None:
    conn = conn or get_db()
    now = now_sql()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE access_requests SET status = 'expired' "
            "WHERE status = 'pending' AND password_expires_at < %s",
            (now,),
        )
        cur.execute(
            "UPDATE access_requests SET status = 'used' "
            "WHERE status = 'unlocked' AND unlock_expires_at < %s",
            (now,),
        )


def revoke_active_item_access(conn, item_id: int) -> int:
    if item_id < 1:
        return 0
    now = now_sql()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE access_requests "
            "SET status = 'used', "
            "    unlock_expires_at = %s, "
            "    password_expires_at = LEAST(password_expires_at, %s) "
            "WHERE item_id = %s AND status IN ('pending', 'unlocked')",
            (now, now, item_id),
        )
        return cur.rowcount


def clear_done_access_requests(conn, notification_id: int | None = None) -> int:
    expire_stale_requests(conn)
    with conn.cursor() as cur:
        if notification_id is not None and notification_id > 0:
            cur.execute(
                "SELECT ar.id "
                "FROM notifications n "
                "JOIN access_requests ar ON ar.id = n.access_request_id "
                "WHERE n.id = %s AND ar.status IN ('used', 'expired') "
                "LIMIT 1",
                (notification_id,),
            )
            row = cur.fetchone()
            if not row:
                return 0
            cur.execute("DELETE FROM access_requests WHERE id = %s", (int(row["id"]),))
            return cur.rowcount
        cur.execute(
            "DELETE FROM access_requests WHERE status IN ('used', 'expired')"
        )
        return cur.rowcount
