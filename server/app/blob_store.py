"""Vercel Blob helpers — client tokens so uploads bypass the 4.5 MB function limit."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from . import config as cfg

BLOB_API = "https://vercel.com/api/blob"
BLOB_API_VERSION = "12"


def blob_enabled() -> bool:
    return bool((os.environ.get("BLOB_READ_WRITE_TOKEN") or "").strip())


def read_write_token() -> str:
    token = (os.environ.get("BLOB_READ_WRITE_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is not set")
    return token


def store_id_from_token(token: str | None = None) -> str:
    raw = token or read_write_token()
    parts = raw.split("_")
    if len(parts) < 4 or not parts[3]:
        raise RuntimeError("Invalid BLOB_READ_WRITE_TOKEN")
    return parts[3]


def is_blob_url(value: str | None) -> bool:
    if not value:
        return False
    return value.startswith("https://") and "blob.vercel-storage.com" in value


def generate_client_token(
    pathname: str,
    *,
    maximum_size_in_bytes: int | None = None,
    add_random_suffix: bool = True,
    valid_for_seconds: int = 3600,
) -> str:
    """Mirror @vercel/blob generateClientTokenFromReadWriteToken (HMAC client token)."""
    import time

    token = read_write_token()
    store_id = store_id_from_token(token)
    valid_until = int((time.time() + valid_for_seconds) * 1000)
    payload_obj: dict[str, Any] = {
        "pathname": pathname,
        "addRandomSuffix": add_random_suffix,
        "validUntil": valid_until,
    }
    if maximum_size_in_bytes is not None:
        payload_obj["maximumSizeInBytes"] = int(maximum_size_in_bytes)

    payload_b64 = base64.b64encode(
        json.dumps(payload_obj, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    signature = hmac.new(
        token.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    combined = base64.b64encode(f"{signature}.{payload_b64}".encode("utf-8")).decode(
        "ascii"
    )
    return f"vercel_blob_client_{store_id}_{combined}"


def delete_blob_url(url: str) -> None:
    """Best-effort delete of a public/private blob by URL."""
    if not is_blob_url(url):
        return
    try:
        token = read_write_token()
    except RuntimeError:
        return
    req = urllib.request.Request(
        f"{BLOB_API}/delete",
        data=json.dumps({"urls": [url]}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "x-api-version": BLOB_API_VERSION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        pass


def safe_upload_pathname(original_name: str) -> str:
    """Path inside the blob store (random folder + sanitized name)."""
    import secrets
    from pathlib import Path

    base = Path(original_name or "file").name
    cleaned = re.sub(r"[^\w.\-]+", "_", base, flags=re.UNICODE).strip("._") or "file"
    if len(cleaned) > 80:
        stem = Path(cleaned).stem[:60]
        ext = Path(cleaned).suffix[:20]
        cleaned = f"{stem}{ext}"
    return f"uploads/{secrets.token_hex(16)}/{cleaned}"


def max_upload_for_host() -> int:
    return int(cfg.MAX_UPLOAD_BYTES)


SQLITE_BLOB_PATH = "app-data/shrees-extractions.sqlite"


def put_private_bytes(pathname: str, data: bytes, *, content_type: str = "application/octet-stream") -> str | None:
    """Server-side overwrite put (read-write token). Returns blob URL or None."""
    from urllib.parse import urlencode

    try:
        token = read_write_token()
        store_id = store_id_from_token(token)
    except RuntimeError:
        return None

    qs = urlencode({"pathname": pathname})
    req = urllib.request.Request(
        f"{BLOB_API}/?{qs}",
        data=data,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "x-api-version": BLOB_API_VERSION,
            "x-vercel-blob-access": "private",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
            "x-content-type": content_type,
            "x-vercel-blob-store-id": store_id,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
            return body.get("url")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None


def get_private_bytes(pathname: str) -> bytes | None:
    """Download a private blob by pathname using the read-write token."""
    try:
        token = read_write_token()
        store_id = store_id_from_token(token)
    except RuntimeError:
        return None

    url = f"https://{store_id}.private.blob.vercel-storage.com/{pathname}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "x-api-version": BLOB_API_VERSION,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            return data if data else None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def restore_sqlite_from_blob(local_path) -> bool:
    """Pull persisted SQLite from Blob into local_path. True if restored."""
    from pathlib import Path

    path = Path(local_path)
    data = get_private_bytes(SQLITE_BLOB_PATH)
    if not data or len(data) < 100:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True


def persist_sqlite_to_blob(local_path) -> bool:
    """Push local SQLite file to Blob so it survives cold starts / redeploys."""
    from pathlib import Path

    path = Path(local_path)
    if not path.is_file():
        return False
    data = path.read_bytes()
    if len(data) < 100:
        return False
    return put_private_bytes(SQLITE_BLOB_PATH, data) is not None

