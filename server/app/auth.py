"""Auth helpers — mirrors PHP config/auth.php + visitor_token()."""
from __future__ import annotations

import re
import secrets
from functools import wraps

import bcrypt
from flask import session, redirect, request, g

from . import config as cfg
from .db import get_db
from .helpers import json_response

PASSWORD_MIN_LENGTH = cfg.PASSWORD_MIN_LENGTH

# Letters and numbers only — no dots, underscores, or hyphens.
_USERNAME_RE = re.compile(r"^[a-z0-9]{3,32}$")


def _php_compatible_hash(password: str) -> str:
    """Create a bcrypt hash with $2y$ prefix (PHP password_hash compatible)."""
    raw = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return raw.decode("utf-8").replace("$2b$", "$2y$", 1)


def verify_password(password: str, password_hash: str) -> bool:
    """Verify against PHP password_hash ($2y$ / $2b$ / $2a$)."""
    if not password_hash:
        return False
    h = password_hash
    if h.startswith("$2y$"):
        h = "$2b$" + h[4:]
    try:
        return bcrypt.checkpw(password.encode("utf-8"), h.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_password(password: str) -> str:
    return _php_compatible_hash(password)


def visitor_token() -> str:
    """Cookie se_visitor — httponly, SameSite=Lax, path=/, 1 year."""
    token = request.cookies.get("se_visitor")
    if token:
        g.visitor_token = token
        g.set_visitor_cookie = False
        return token
    token = secrets.token_hex(16)
    g.visitor_token = token
    g.set_visitor_cookie = True
    return token


def attach_visitor_cookie(response):
    if getattr(g, "set_visitor_cookie", False) and getattr(g, "visitor_token", None):
        response.set_cookie(
            "se_visitor",
            g.visitor_token,
            max_age=60 * 60 * 24 * 365,
            path="/",
            httponly=True,
            samesite="Lax",
            secure=bool(cfg.ON_VERCEL),
        )
    return response


def admin_logged_in() -> bool:
    admin_id = int(session.get("admin_id") or 0)
    if admin_id < 1:
        return False
    if getattr(g, "_admin_ok", None) is not None:
        return g._admin_ok
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username FROM admins WHERE id = %s LIMIT 1", (admin_id,)
            )
            row = cur.fetchone()
    except Exception:
        # DB blip — keep the session; don't bounce to login
        g._admin_ok = True
        return True
    if not row:
        logout_admin()
        g._admin_ok = False
        return False
    session["admin_username"] = str(row["username"])
    session.permanent = True
    g._admin_ok = True
    return True


def require_admin():
    if not admin_logged_in():
        return redirect(f"{cfg.URL_PREFIX}/app/login.php")
    return None


def require_admin_api():
    if not admin_logged_in():
        return json_response({"ok": False, "error": "Unauthorized"}, 401)
    return None


def after_login_redirect():
    return redirect(f"{cfg.URL_PREFIX}/")


def parse_username(raw: str) -> tuple[str | None, str | None]:
    user = raw.strip().lower()
    if user == "":
        return None, "Enter a username."
    if len(user) < 3:
        return None, "Username must be at least 3 characters."
    if len(user) > 32:
        return None, "Username must be 32 characters or fewer."
    if not _USERNAME_RE.match(user):
        return (
            None,
            "Use 3–32 lowercase letters and numbers only — no dots, spaces, "
            "underscores, or hyphens.",
        )
    return user, None


def username_taken(normalized: str, except_id: int | None = None) -> bool:
    conn = get_db()
    sql = "SELECT id FROM admins WHERE LOWER(username) = %s"
    params: list = [normalized]
    if except_id is not None:
        sql += " AND id != %s"
        params.append(except_id)
    sql += " LIMIT 1"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return bool(cur.fetchone())


def username_collides(raw: str, except_id: int | None = None) -> bool:
    """True if this exact username is already taken."""
    lower = raw.strip().lower()
    if lower == "" or len(lower) < 3:
        return False
    return username_taken(lower, except_id)


def username_taken_message() -> str:
    lines = [
        "That username is already taken.",
        "Someone already uses that name — try another.",
        "This username is not available.",
        "That name is taken. Pick a different one.",
        "Already in use. Choose another username.",
        "Nope — that username belongs to someone else.",
    ]
    return secrets.choice(lines)


def attempt_login(username: str, password: str) -> bool:
    user, error = parse_username(username)
    if error is not None:
        user = username.strip().lower()
        if user == "":
            return False
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, username, password_hash FROM admins WHERE LOWER(username) = %s LIMIT 1",
            (user,),
        )
        admin = cur.fetchone()
    if not admin or not verify_password(password, admin["password_hash"]):
        return False
    session.clear()
    session["admin_id"] = int(admin["id"])
    session["admin_username"] = str(admin["username"])
    session.permanent = True
    return True


def admin_count() -> int:
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM admins")
        row = cur.fetchone()
    return int(row["c"] if row else 0)


def create_admin(username: str, password: str) -> bool:
    user, error = parse_username(username)
    if error is not None or len(password) < PASSWORD_MIN_LENGTH or username_collides(user):
        return False
    pw_hash = hash_password(password)
    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO admins (username, password_hash) VALUES (%s, %s)",
            (user, pw_hash),
        )
    return True


def logout_admin() -> None:
    session.clear()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        redir = require_admin()
        if redir is not None:
            return redir
        return view(*args, **kwargs)

    return wrapped


def api_login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        err = require_admin_api()
        if err is not None:
            return err
        return view(*args, **kwargs)

    return wrapped
