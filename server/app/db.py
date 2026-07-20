"""MySQL connection helpers (PyMySQL) — mirrors PHP bootstrap db()."""
from __future__ import annotations

import pymysql
from pymysql.cursors import DictCursor
from flask import g, current_app

from . import config as cfg


def get_db():
    """Return a per-request DB connection (DictCursor)."""
    if "db" not in g:
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
    """Add newer columns on older databases without a full re-import."""
    if getattr(conn, "_se_schema_done", False):
        return
    conn._se_schema_done = True
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
        # Schema ensure is best-effort
        pass
