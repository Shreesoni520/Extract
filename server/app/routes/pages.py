"""HTML page routes — mirrors PHP index + app/*.php."""
from __future__ import annotations

import os
import re
import secrets
from pathlib import Path

from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    session,
)

from .. import config as cfg
from ..db import get_db
from ..auth import (
    admin_logged_in,
    require_admin,
    attempt_login,
    create_admin,
    logout_admin,
    after_login_redirect,
    parse_username,
    username_collides,
    username_taken_message,
    verify_password,
    hash_password,
    PASSWORD_MIN_LENGTH,
    visitor_token,
)
from ..helpers import (
    ensure_upload_dir,
    expire_stale_requests,
    revoke_active_item_access,
    format_bytes,
    avatar_url,
    detect_mime,
)

pages_bp = Blueprint("pages", __name__)


def _flash_redirect(flash_type: str, text: str):
    # Keep auth keys while setting flash (never wipe the login session here)
    session["flash"] = {"type": flash_type, "text": text}
    session.permanent = True
    session.modified = True
    return redirect(f"{cfg.URL_PREFIX}/app/")


@pages_bp.route("/")
def home():
    visitor_token()
    logged_in = admin_logged_in()
    username = str(session.get("admin_username") or "")
    open_browse = logged_in and ("browse" in request.args)
    notice = session.pop("home_notice", None) or ""
    return render_template(
        "index.html",
        logged_in=logged_in,
        username=username,
        open_browse=open_browse,
        notice=notice,
    )


@pages_bp.route("/app/login.php", methods=["GET", "POST"])
def login():
    if admin_logged_in():
        return after_login_redirect()
    error = ""
    info = ""
    username_value = ""
    if request.args.get("registered") == "1":
        info = "Account created. Sign in with your username and password."
    if request.method == "POST":
        user = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        username_value = user.lower().strip()
        if user == "" or password == "":
            error = "Enter username and password."
        elif attempt_login(user, password):
            return after_login_redirect()
        else:
            error = "Wrong username or password. If you just signed up, use that same name — no dots."
    return render_template(
        "login.html",
        error=error,
        info=info,
        username_value=username_value,
    )


@pages_bp.route("/app/register.php", methods=["GET", "POST"])
def register():
    if admin_logged_in():
        return after_login_redirect()
    error = ""
    username_value = ""
    if request.method == "POST":
        user = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        confirm = request.form.get("confirm") or ""
        username_value = user.lower().strip()

        normalized, user_error = parse_username(user)
        if user_error is not None:
            error = user_error
        elif len(password) < PASSWORD_MIN_LENGTH:
            error = f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
        elif password != confirm:
            error = "Passwords do not match."
        elif username_collides(user):
            error = username_taken_message()
        elif create_admin(normalized, password):
            if attempt_login(normalized, password):
                session["home_notice"] = f"Welcome, {normalized} — you’re signed in."
                session.permanent = True
                session.modified = True
                return after_login_redirect()
            return redirect(f"{cfg.URL_PREFIX}/app/login.php?registered=1")
        else:
            error = "Could not create account. Try again."
    return render_template(
        "register.html", error=error, username_value=username_value
    )


@pages_bp.route("/app/logout.php")
def logout():
    logout_admin()
    return redirect(f"{cfg.URL_PREFIX}/")


@pages_bp.route("/app/setup.php")
def setup():
    return redirect(f"{cfg.URL_PREFIX}/app/register.php")


@pages_bp.route("/app/users.php")
def users_page():
    # Optional: redirect to account (main flows are elsewhere)
    redir = require_admin()
    if redir:
        return redir
    return redirect(f"{cfg.URL_PREFIX}/app/account.php")


@pages_bp.route("/app/", methods=["GET", "POST"])
@pages_bp.route("/app", methods=["GET", "POST"])
def admin_upload():
    redir = require_admin()
    if redir:
        return redir

    conn = get_db()
    ensure_upload_dir()
    me_id = int(session.get("admin_id") or 0)

    if request.method == "POST":
        action = request.form.get("action") or ""

        if action == "upload":
            title = (request.form.get("title") or "").strip()
            description = (request.form.get("description") or "").strip()
            file = request.files.get("file")

            if title == "":
                return _flash_redirect("error", "Title is required.")
            if not file or not file.filename:
                return _flash_redirect("error", "Choose a file to upload.")

            # Prefer Content-Length when present (avoids reading huge bodies twice)
            declared = request.content_length
            if declared is not None and declared > cfg.MAX_UPLOAD_BYTES + (2 * 1024 * 1024):
                return _flash_redirect(
                    "error",
                    f"File is too large. Maximum upload size is {cfg.max_upload_label()}.",
                )

            original_name = file.filename
            ext = Path(original_name).suffix.lstrip(".")
            safe_ext = re.sub(r"[^a-zA-Z0-9]", "", ext)
            stored = secrets.token_hex(16) + (
                f".{safe_ext.lower()}" if safe_ext else ""
            )
            dest = Path(cfg.UPLOAD_DIR) / stored
            try:
                # Stream to disk (Werkzeug spills large bodies to a temp file)
                file.save(dest)
            except OSError:
                return _flash_redirect("error", "Upload failed — could not save the file.")

            try:
                size = dest.stat().st_size
            except OSError:
                size = 0
            if size < 1:
                try:
                    dest.unlink()
                except OSError:
                    pass
                return _flash_redirect("error", "Upload failed — empty file.")
            if size > cfg.MAX_UPLOAD_BYTES:
                try:
                    dest.unlink()
                except OSError:
                    pass
                return _flash_redirect(
                    "error",
                    f"File is too large. Maximum upload size is {cfg.max_upload_label()}.",
                )

            mime = detect_mime(dest, file.mimetype or "application/octet-stream")
            if me_id < 1:
                try:
                    dest.unlink()
                except OSError:
                    pass
                return _flash_redirect("error", "Not logged in.")
            require_password = 1 if request.form.get("require_password") else 0
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO items "
                        "(admin_id, title, description, filename, original_name, mime_type, file_size, require_password) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (
                            me_id,
                            title,
                            description if description else None,
                            stored,
                            original_name,
                            mime,
                            size,
                            require_password,
                        ),
                    )
            except Exception:
                if dest.is_file():
                    try:
                        dest.unlink()
                    except OSError:
                        pass
                return _flash_redirect("error", "Upload failed — database error.")
            return _flash_redirect("ok", "File uploaded.")

        if action == "toggle_password":
            item_id = int(request.form.get("item_id") or 0)
            if item_id > 0 and me_id > 0:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE items SET require_password = 1 - require_password "
                        "WHERE id = %s AND admin_id = %s",
                        (item_id, me_id),
                    )
                    if cur.rowcount > 0:
                        cur.execute(
                            "SELECT require_password FROM items "
                            "WHERE id = %s AND admin_id = %s LIMIT 1",
                            (item_id, me_id),
                        )
                        row = cur.fetchone()
                        if row and int(row["require_password"]) == 1:
                            revoke_active_item_access(conn, item_id)
                        return _flash_redirect("ok", "Permission setting updated.")
            return _flash_redirect("error", "Could not update permission.")

        if action == "lock_all":
            item_id = int(request.form.get("item_id") or 0)
            if item_id > 0 and me_id > 0:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM items WHERE id = %s AND admin_id = %s LIMIT 1",
                        (item_id, me_id),
                    )
                    if cur.fetchone():
                        revoke_active_item_access(conn, item_id)
                        return _flash_redirect("ok", "Access locked again for that file.")
            return _flash_redirect("error", "Could not lock that file.")

        if action == "toggle":
            item_id = int(request.form.get("item_id") or 0)
            if item_id > 0 and me_id > 0:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE items SET is_active = 1 - is_active "
                        "WHERE id = %s AND admin_id = %s",
                        (item_id, me_id),
                    )
                    if cur.rowcount > 0:
                        return _flash_redirect("ok", "Item visibility updated.")
            return _flash_redirect("error", "Could not update visibility.")

        if action == "delete":
            item_id = int(request.form.get("item_id") or 0)
            if item_id > 0 and me_id > 0:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT filename FROM items WHERE id = %s AND admin_id = %s",
                        (item_id, me_id),
                    )
                    row = cur.fetchone()
                    if row:
                        stored = row["filename"] or ""
                        cur.execute(
                            "DELETE FROM items WHERE id = %s AND admin_id = %s",
                            (item_id, me_id),
                        )
                        from ..blob_store import is_blob_url, delete_blob_url

                        if is_blob_url(stored) or stored.startswith("https://"):
                            delete_blob_url(stored)
                        else:
                            path = Path(cfg.UPLOAD_DIR) / stored
                            if path.is_file():
                                try:
                                    path.unlink()
                                except OSError:
                                    pass
                        return _flash_redirect("ok", "Item deleted.")
            return _flash_redirect("error", "Could not delete that file.")

    flash = session.pop("flash", None)
    if not flash and request.args.get("uploaded") == "1":
        flash = {"type": "ok", "text": "File uploaded."}
    message = (
        str(flash["text"])
        if flash and flash.get("type") == "ok"
        else ""
    )
    error = (
        str(flash["text"])
        if flash and flash.get("type") == "error"
        else ""
    )

    expire_stale_requests(conn)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT i.*, a.username AS uploader, "
            "       (SELECT COUNT(*) FROM access_requests ar "
            "        WHERE ar.item_id = i.id AND ar.status = 'unlocked') AS unlocked_count "
            "FROM items i "
            "LEFT JOIN admins a ON a.id = i.admin_id "
            "WHERE i.admin_id = %s "
            "ORDER BY i.created_at DESC",
            (me_id,),
        )
        items = cur.fetchall()

    # Attach formatted size for templates
    for item in items:
        item["file_size_fmt"] = format_bytes(int(item["file_size"]))

    # Paginate like PHP (4 per page)
    page_size = 4
    chunks = [items[i : i + page_size] for i in range(0, len(items), page_size)] or []
    owner_pages = len(chunks) if chunks else 0
    owner_multi = owner_pages > 1

    return render_template(
        "app_index.html",
        message=message,
        error=error,
        items=items,
        owner_chunks=chunks,
        owner_pages=owner_pages,
        owner_multi=owner_multi,
        username=str(session.get("admin_username") or "admin"),
    )


@pages_bp.route("/app/account.php", methods=["GET", "POST"])
def account():
    redir = require_admin()
    if redir:
        return redir

    ensure_upload_dir()
    message = ""
    error = ""
    admin_id = int(session.get("admin_id") or 0)
    conn = get_db()

    if request.method == "POST" and (request.form.get("action") or "") == "avatar":
        file = request.files.get("avatar")
        if not file or not file.filename:
            error = "Choose a profile image."
        else:
            # Peek mime from content / extension
            tmp_path = None
            try:
                # Save to temp then check
                import tempfile

                suffix = Path(file.filename).suffix
                fd, tmp_name = tempfile.mkstemp(suffix=suffix)
                os.close(fd)
                tmp_path = Path(tmp_name)
                file.save(tmp_path)
                mime = detect_mime(tmp_path)
                allowed = {
                    "image/jpeg": "jpg",
                    "image/png": "png",
                    "image/webp": "webp",
                    "image/gif": "gif",
                }
                size = tmp_path.stat().st_size
                if mime not in allowed:
                    error = "Use JPG, PNG, WEBP, or GIF."
                elif size > 3 * 1024 * 1024:
                    error = "Image too large (max 3 MB)."
                else:
                    stored = secrets.token_hex(12) + "." + allowed[mime]
                    dest = Path(cfg.UPLOAD_DIR) / "avatars" / stored
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT avatar FROM admins WHERE id = %s", (admin_id,)
                        )
                        old_row = cur.fetchone()
                        old_name = old_row["avatar"] if old_row else None
                    tmp_path.replace(dest)
                    tmp_path = None
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE admins SET avatar = %s WHERE id = %s",
                            (stored, admin_id),
                        )
                    if isinstance(old_name, str) and old_name:
                        old_path = Path(cfg.UPLOAD_DIR) / "avatars" / Path(old_name).name
                        if old_path.is_file():
                            try:
                                old_path.unlink()
                            except OSError:
                                pass
                    message = "Profile image updated."
            finally:
                if tmp_path and tmp_path.is_file():
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass

    if request.method == "POST" and (request.form.get("action") or "") == "account":
        current = request.form.get("current_password") or ""
        new_user = (request.form.get("new_username") or "").strip()
        new_pass = request.form.get("new_password") or ""
        confirm = request.form.get("confirm_password") or ""

        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, password_hash FROM admins WHERE id = %s LIMIT 1",
                (admin_id,),
            )
            admin = cur.fetchone()

        if not admin:
            logout_admin()
            return redirect(f"{cfg.URL_PREFIX}/app/login.php")
        if new_user == "" or len(new_user) < 3:
            error = "Username must be at least 3 characters."
        elif new_pass != "" and len(new_pass) < PASSWORD_MIN_LENGTH:
            error = f"New password must be at least {PASSWORD_MIN_LENGTH} characters."
        elif new_pass != "" and (
            current == "" or not verify_password(current, admin["password_hash"])
        ):
            error = (
                "To change your password, enter the password you already use to sign in."
            )
        else:
            normalized, user_error = parse_username(new_user)
            if user_error is not None:
                error = user_error
            elif new_pass != "" and new_pass != confirm:
                error = "New password and confirm do not match."
            elif username_collides(new_user, admin_id):
                error = username_taken_message()
            else:
                with conn.cursor() as cur:
                    if new_pass != "":
                        pw_hash = hash_password(new_pass)
                        cur.execute(
                            "UPDATE admins SET username = %s, password_hash = %s WHERE id = %s",
                            (normalized, pw_hash, admin_id),
                        )
                        message = "Username and password updated."
                    else:
                        cur.execute(
                            "UPDATE admins SET username = %s WHERE id = %s",
                            (normalized, admin_id),
                        )
                        message = (
                            "Username updated."
                            if normalized != str(admin["username"])
                            else "Nothing to change."
                        )
                session["admin_username"] = normalized

    with conn.cursor() as cur:
        cur.execute(
            "SELECT username, avatar FROM admins WHERE id = %s LIMIT 1", (admin_id,)
        )
        me = cur.fetchone() or {"username": "", "avatar": None}

    current_username = str(me["username"])
    avatar_src = avatar_url(
        str(me["avatar"]) if me["avatar"] else None, admin_id
    )
    return render_template(
        "account.html",
        message=message,
        error=error,
        current_username=current_username,
        avatar_src=avatar_src,
    )
