"""DB helpers — MySQL locally, SQLite on Vercel by default."""
from __future__ import annotations

import re
import sqlite3
from typing import Any, Optional

from flask import g

from . import config as cfg

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  avatar VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT DEFAULT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  require_password INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  visitor_token VARCHAR(64) NOT NULL,
  requester_id INTEGER DEFAULT NULL,
  password_plain VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  password_expires_at DATETIME NOT NULL,
  unlocked_at DATETIME DEFAULT NULL,
  unlock_expires_at DATETIME DEFAULT NULL,
  FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE,
  FOREIGN KEY (requester_id) REFERENCES admins (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_request_id INTEGER NOT NULL,
  message VARCHAR(255) NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (access_request_id) REFERENCES access_requests (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visitor_item ON access_requests (visitor_token, item_id);
CREATE INDEX IF NOT EXISTS idx_status ON access_requests (status);
"""


def _adapt_sql(sql: str) -> str:
    """Translate MySQL-ish SQL to SQLite."""
    out = sql.replace("%s", "?")
    out = re.sub(r"\bNOW\(\)", "datetime('now')", out, flags=re.IGNORECASE)
    # SQLite uses min() for scalar least-of-args
    out = re.sub(r"\bLEAST\s*\(", "min(", out, flags=re.IGNORECASE)
    return out


class _SqliteCursor:
    def __init__(self, conn: "_SqliteConnection"):
        self._conn = conn
        self._cur = conn._raw.cursor()
        self.lastrowid = 0
        self.rowcount = -1

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._cur.close()
        return False

    def execute(self, sql: str, params: Optional[Any] = None):
        adapted = _adapt_sql(sql)
        self._cur.execute(adapted, params or ())
        self.lastrowid = self._cur.lastrowid or 0
        self.rowcount = self._cur.rowcount
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in self._cur.description]
        return dict(zip(cols, row))

    def fetchall(self):
        rows = self._cur.fetchall()
        if not rows:
            return []
        cols = [d[0] for d in self._cur.description]
        return [dict(zip(cols, r)) for r in rows]

    def close(self):
        self._cur.close()


class _SqliteConnection:
    def __init__(self, path: str):
        self._raw = sqlite3.connect(path, check_same_thread=False)
        self._raw.row_factory = None
        self._autocommit = True
        self._raw.isolation_level = None  # autocommit mode
        self._raw.execute("PRAGMA foreign_keys = ON")

    def cursor(self):
        return _SqliteCursor(self)

    def autocommit(self, enabled: bool):
        self._autocommit = bool(enabled)
        # None = autocommit; "" = transactional
        self._raw.isolation_level = None if enabled else ""

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def _init_sqlite(conn: _SqliteConnection) -> None:
    cur = conn._raw.cursor()
    cur.executescript(_SQLITE_SCHEMA)
    conn._raw.commit() if conn._raw.isolation_level is not None else None


def get_db():
    """Return a per-request DB connection (dict rows)."""
    if "db" not in g:
        if cfg.USE_SQLITE:
            cfg.SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            conn = _SqliteConnection(str(cfg.SQLITE_PATH))
            _init_sqlite(conn)
            g.db = conn
        else:
            import pymysql
            from pymysql.cursors import DictCursor

            conn = pymysql.connect(
                host=cfg.DB_HOST,
                user=cfg.DB_USER,
                password=cfg.DB_PASS,
                database=cfg.DB_NAME,
                charset=cfg.DB_CHARSET,
                cursorclass=DictCursor,
                autocommit=True,
            )
            g.db = conn
            ensure_schema(conn)
    return g.db


def close_db(_e=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def ensure_schema(conn) -> None:
    """Add newer columns on older MySQL databases without a full re-import."""
    if getattr(conn, "_se_schema_done", False):
        return
    conn._se_schema_done = True
    if cfg.USE_SQLITE:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW COLUMNS FROM admins LIKE 'avatar'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE admins ADD COLUMN avatar VARCHAR(255) NULL AFTER password_hash"
                )
            cur.execute("SHOW COLUMNS FROM items LIKE 'require_password'")
            if not cur.fetchone():
                cur.execute(
                    "ALTER TABLE items ADD COLUMN require_password TINYINT(1) NOT NULL DEFAULT 1 AFTER file_size"
                )
            cur.execute("SHOW COLUMNS FROM access_requests LIKE 'requester_id'")
            if not cur.fetchone():
                try:
                    cur.execute(
                        "ALTER TABLE access_requests "
                        "ADD COLUMN requester_id INT UNSIGNED NULL AFTER visitor_token"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        "ALTER TABLE access_requests ADD KEY idx_requester (requester_id)"
                    )
                except Exception:
                    pass
                try:
                    cur.execute(
                        "ALTER TABLE access_requests "
                        "ADD CONSTRAINT fk_access_requester "
                        "FOREIGN KEY (requester_id) REFERENCES admins (id) ON DELETE SET NULL"
                    )
                except Exception:
                    pass
    except Exception:
        pass
