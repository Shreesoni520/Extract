"""JSON API routes — keep .php URL suffixes for frontend compatibility."""
from __future__ import annotations

import re
from pathlib import Path

import hmac
import time

from flask import Blueprint, session, request, send_file, make_response, render_template

from .. import config as cfg
from ..db import get_db
from ..auth import (
    api_login_required,
    visitor_token,
)
from ..helpers import (
    json_response,
    require_method,
    read_json_body,
    expire_stale_requests,
    revoke_active_item_access,
    clear_done_access_requests,
    generate_password,
    format_bytes,
    is_previewable,
    avatar_url,
    sql_datetime,
    seconds_left,
    now_sql,
    detect_mime,
    parse_sql_datetime,
)
from ..notifications import notifications_payload

api_bp = Blueprint("api", __name__)


def locked_page(title: str, message: str, status: int = 403):
    html = render_template("locked.html", title=title, message=message)
    return make_response(html, status)


def _fmt_dt(value):
    if value is None:
        return None
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


@api_bp.route("/users.php")
@api_login_required
def users():
    q = (request.args.get("q") or "").strip()
    me_id = int(session.get("admin_id") or 0)
    min_len = 2

    if q == "" or len(q) < min_len:
        return json_response(
            {"ok": True, "query": q, "min_length": min_len, "users": []}
        )

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.id, a.username, a.avatar, a.created_at, "
            "       (SELECT COUNT(*) FROM items i WHERE i.admin_id = a.id AND i.is_active = 1) AS file_count "
            "FROM admins a "
            "WHERE a.id != %s AND LOWER(a.username) LIKE %s "
            "ORDER BY a.username ASC LIMIT 40",
            (me_id, "%" + q.lower() + "%"),
        )
        rows = cur.fetchall()

    users_out = []
    for u in rows:
        uid = int(u["id"])
        users_out.append(
            {
                "id": uid,
                "username": u["username"],
                "avatar": avatar_url(str(u["avatar"]) if u["avatar"] else None, uid),
                "file_count": int(u["file_count"]),
                "created_at": _fmt_dt(u["created_at"]),
            }
        )
    return json_response(
        {"ok": True, "query": q, "min_length": min_len, "users": users_out}
    )


@api_bp.route("/items.php")
@api_login_required
def items():
    expire_stale_requests()
    token = visitor_token()
    conn = get_db()

    user_id = int(request.args.get("user_id") or 0)
    if user_id < 1:
        return json_response({"ok": False, "error": "user_id required"}, 400)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT i.id, i.title, i.description, i.mime_type, i.file_size, i.original_name, i.created_at, "
            "       i.require_password, a.username AS uploader, a.id AS uploader_id, a.avatar "
            "FROM items i "
            "LEFT JOIN admins a ON a.id = i.admin_id "
            "WHERE i.is_active = 1 AND i.admin_id = %s "
            "ORDER BY i.created_at DESC",
            (user_id,),
        )
        item_rows = cur.fetchall()

        states = {}
        for item in item_rows:
            iid = int(item["id"])
            if not int(item["require_password"]):
                states[iid] = {
                    "status": "open",
                    "can_preview": is_previewable(item["mime_type"]),
                }
                continue
            cur.execute(
                "SELECT id, item_id, status, password_expires_at, unlock_expires_at "
                "FROM access_requests "
                "WHERE visitor_token = %s AND item_id = %s AND status IN ('pending','unlocked') "
                "ORDER BY id DESC LIMIT 1",
                (token, iid),
            )
            req = cur.fetchone()
            if not req:
                states[iid] = {"status": "locked"}
            elif req["status"] == "pending":
                states[iid] = {
                    "status": "pending",
                    "request_id": int(req["id"]),
                    "seconds_left": seconds_left(req["password_expires_at"]),
                }
            else:
                states[iid] = {
                    "status": "unlocked",
                    "request_id": int(req["id"]),
                    "seconds_left": seconds_left(req["unlock_expires_at"]),
                    "can_preview": is_previewable(item["mime_type"]),
                }

    items_out = []
    for item in item_rows:
        state = states.get(int(item["id"]), {"status": "locked"})
        uid = int(item["uploader_id"] or 0)
        items_out.append(
            {
                "id": int(item["id"]),
                "title": item["title"],
                "description": item["description"],
                "uploader": item["uploader"] or "unknown",
                "uploader_id": uid,
                "uploader_avatar": avatar_url(
                    str(item["avatar"]) if item["avatar"] else None, uid
                ),
                "require_password": bool(item["require_password"]),
                "mime_type": item["mime_type"],
                "file_size": format_bytes(int(item["file_size"])),
                "original_name": item["original_name"],
                "created_at": _fmt_dt(item["created_at"]),
                "access": state,
            }
        )
    return json_response({"ok": True, "user_id": user_id, "items": items_out})


@api_bp.route("/request-access.php", methods=["POST", "GET", "PUT", "DELETE", "PATCH"])
@api_login_required
def request_access():
    err = require_method("POST")
    if err:
        return err
    expire_stale_requests()

    body = read_json_body()
    item_id = int(body.get("item_id") or 0)
    if item_id < 1:
        return json_response({"ok": False, "error": "Invalid item"}, 400)

    conn = get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, require_password FROM items WHERE id = %s AND is_active = 1 LIMIT 1",
            (item_id,),
        )
        item = cur.fetchone()
        if not item:
            return json_response({"ok": False, "error": "Item not found"}, 404)
        if not int(item["require_password"]):
            return json_response(
                {"ok": False, "error": "This file is open — no password needed"}, 400
            )

        token = visitor_token()
        requester_id = int(session.get("admin_id") or 0)
        requester_name = (session.get("admin_username") or "").strip()

        cur.execute(
            "SELECT id, status, password_expires_at, unlock_expires_at "
            "FROM access_requests "
            "WHERE item_id = %s AND visitor_token = %s AND status IN ('pending','unlocked') "
            "ORDER BY id DESC LIMIT 1",
            (item_id, token),
        )
        existing = cur.fetchone()
        if existing:
            if existing["status"] == "pending":
                return json_response(
                    {
                        "ok": True,
                        "status": "pending",
                        "request_id": int(existing["id"]),
                        "seconds_left": seconds_left(existing["password_expires_at"]),
                        "message": "Password already requested. Enter it within the time window.",
                    }
                )
            if existing["status"] == "unlocked":
                return json_response(
                    {
                        "ok": True,
                        "status": "unlocked",
                        "request_id": int(existing["id"]),
                        "seconds_left": seconds_left(existing["unlock_expires_at"]),
                        "message": "You already have active access.",
                    }
                )

        password = generate_password(6)
        password_expires = sql_datetime(time.time() + cfg.PASSWORD_TTL_SECONDS)

        try:
            conn.autocommit(False)
            try:
                try:
                    cur.execute(
                        "INSERT INTO access_requests "
                        "(item_id, visitor_token, requester_id, password_plain, status, password_expires_at) "
                        "VALUES (%s, %s, %s, %s, 'pending', %s)",
                        (
                            item_id,
                            token,
                            requester_id if requester_id > 0 else None,
                            password,
                            password_expires,
                        ),
                    )
                except Exception:
                    cur.execute(
                        "INSERT INTO access_requests "
                        "(item_id, visitor_token, password_plain, status, password_expires_at) "
                        "VALUES (%s, %s, %s, 'pending', %s)",
                        (item_id, token, password, password_expires),
                    )
                request_id = cur.lastrowid
                who = f"@{requester_name}" if requester_name else "Someone"
                msg = f'{who} requested access to "{item["title"]}" — password: {password}'
                cur.execute(
                    "INSERT INTO notifications (access_request_id, message) VALUES (%s, %s)",
                    (request_id, msg),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                return json_response(
                    {"ok": False, "error": "Could not create request"}, 500
                )
            finally:
                conn.autocommit(True)
        except Exception:
            return json_response({"ok": False, "error": "Could not create request"}, 500)

    return json_response(
        {
            "ok": True,
            "status": "pending",
            "request_id": request_id,
            "seconds_left": cfg.PASSWORD_TTL_SECONDS,
            "message": "Request sent. Enter the password within 5 minutes once you receive it.",
        }
    )


@api_bp.route("/verify-password.php", methods=["POST", "GET", "PUT", "DELETE", "PATCH"])
def verify_password():
    err = require_method("POST")
    if err:
        return err
    expire_stale_requests()

    body = read_json_body()
    item_id = int(body.get("item_id") or 0)
    password = (body.get("password") or "").strip().upper()

    if item_id < 1 or password == "":
        return json_response(
            {"ok": False, "error": "Item and password are required"}, 400
        )

    conn = get_db()
    token = visitor_token()

    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM access_requests "
            "WHERE item_id = %s AND visitor_token = %s AND status = 'pending' "
            "ORDER BY id DESC LIMIT 1",
            (item_id, token),
        )
        req = cur.fetchone()
        if not req:
            return json_response(
                {
                    "ok": False,
                    "error": "No active password request. Request access first.",
                },
                400,
            )

        exp_ts = parse_sql_datetime(req["password_expires_at"])
        if exp_ts is None or exp_ts < time.time():
            cur.execute(
                "UPDATE access_requests SET status = 'expired' WHERE id = %s",
                (req["id"],),
            )
            return json_response(
                {"ok": False, "error": "Password expired. Request a new one."}, 410
            )

        if not hmac.compare_digest(str(req["password_plain"]).upper(), password):
            return json_response({"ok": False, "error": "Wrong password"}, 403)

        unlocked_at = now_sql()
        unlock_expires = sql_datetime(time.time() + cfg.UNLOCK_TTL_SECONDS)
        cur.execute(
            "UPDATE access_requests "
            "SET status = 'unlocked', unlocked_at = %s, unlock_expires_at = %s "
            "WHERE id = %s",
            (unlocked_at, unlock_expires, req["id"]),
        )

    return json_response(
        {
            "ok": True,
            "status": "unlocked",
            "request_id": int(req["id"]),
            "seconds_left": cfg.UNLOCK_TTL_SECONDS,
            "message": "Unlocked. You have 5 minutes — one session only.",
        }
    )


@api_bp.route("/check-access.php")
@api_login_required
def check_access():
    expire_stale_requests()
    item_id = int(request.args.get("item_id") or 0)
    if item_id < 1:
        return json_response({"ok": False, "error": "item_id required"}, 400)

    conn = get_db()
    token = visitor_token()

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, require_password, mime_type, is_active FROM items WHERE id = %s LIMIT 1",
            (item_id,),
        )
        item = cur.fetchone()
        if not item or not int(item["is_active"]):
            return json_response({"ok": True, "status": "missing"})

        if not int(item["require_password"]):
            return json_response(
                {
                    "ok": True,
                    "status": "open",
                    "can_preview": is_previewable(item["mime_type"]),
                }
            )

        cur.execute(
            "SELECT id, status, password_expires_at, unlock_expires_at "
            "FROM access_requests "
            "WHERE visitor_token = %s AND item_id = %s AND status IN ('pending', 'unlocked') "
            "ORDER BY id DESC LIMIT 1",
            (token, item_id),
        )
        req = cur.fetchone()
        if not req:
            return json_response({"ok": True, "status": "locked"})

        if req["status"] == "pending":
            return json_response(
                {
                    "ok": True,
                    "status": "pending",
                    "request_id": int(req["id"]),
                    "seconds_left": seconds_left(req["password_expires_at"]),
                }
            )

        left = seconds_left(req["unlock_expires_at"])
        if left < 1:
            cur.execute(
                "UPDATE access_requests SET status = 'used' WHERE id = %s",
                (int(req["id"]),),
            )
            return json_response({"ok": True, "status": "locked"})

        return json_response(
            {
                "ok": True,
                "status": "unlocked",
                "request_id": int(req["id"]),
                "seconds_left": left,
                "can_preview": is_previewable(item["mime_type"]),
            }
        )


@api_bp.route("/download.php")
def download():
    expire_stale_requests()
    item_id = int(request.args.get("item_id") or 0)
    mode = "view" if (request.args.get("mode") or "download") == "view" else "download"

    if item_id < 1:
        return locked_page(
            "Something went wrong",
            "This file link is not valid. Go back home and choose a file again.",
            400,
        )

    conn = get_db()
    token = visitor_token()
    upload_dir = Path(cfg.UPLOAD_DIR)

    def serve_file(row: dict, serve_mode: str):
        path = upload_dir / row["filename"]
        if not path.is_file():
            return locked_page(
                "File unavailable",
                "This file could not be found. Please go home and try another file.",
                404,
            )
        mime = row["mime_type"] or "application/octet-stream"
        filename = row["original_name"]
        as_attachment = not (serve_mode == "view" and is_previewable(mime))
        resp = send_file(
            path,
            mimetype=mime,
            as_attachment=as_attachment,
            download_name=filename,
            conditional=False,
            max_age=0,
        )
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    with conn.cursor() as cur:
        cur.execute(
            "SELECT filename, original_name, mime_type, title, require_password "
            "FROM items WHERE id = %s AND is_active = 1 LIMIT 1",
            (item_id,),
        )
        item = cur.fetchone()
        if not item:
            return locked_page(
                "File unavailable",
                "This file could not be found. Please go home and try another file.",
                404,
            )

        if not int(item["require_password"]):
            return serve_file(item, mode)

        cur.execute(
            "SELECT ar.*, i.filename, i.original_name, i.mime_type, i.title, i.is_active, i.require_password "
            "FROM access_requests ar "
            "JOIN items i ON i.id = ar.item_id "
            "WHERE ar.item_id = %s AND ar.visitor_token = %s AND ar.status = 'unlocked' "
            "ORDER BY ar.id DESC LIMIT 1",
            (item_id, token),
        )
        access = cur.fetchone()

        still_valid = (
            access
            and int(access["is_active"]) == 1
            and int(access["require_password"]) == 1
            and seconds_left(access["unlock_expires_at"]) >= 1
        )

        if not still_valid:
            if access:
                cur.execute(
                    "UPDATE access_requests "
                    "SET status = 'used', "
                    "    unlock_expires_at = LEAST(COALESCE(unlock_expires_at, NOW()), NOW()) "
                    "WHERE id = %s",
                    (access["id"],),
                )
            return locked_page(
                "Access locked",
                "This file is locked again. Request a new password from the home page to open it.",
                403,
            )

        return serve_file(access, mode)


@api_bp.route("/avatar.php")
def avatar():
    conn = get_db()
    file = Path(request.args.get("f") or "").name
    user_id = int(request.args.get("u") or 0)
    avatars_dir = Path(cfg.UPLOAD_DIR) / "avatars"

    path = None
    mime = "image/png"
    file_re = re.compile(r"^[a-f0-9]+\.(jpg|jpeg|png|webp|gif)$", re.I)

    if file and file_re.match(file):
        candidate = avatars_dir / file
        if candidate.is_file():
            path = candidate
            detected = detect_mime(candidate)
            if detected.startswith("image/"):
                mime = detected
    elif user_id > 0:
        with conn.cursor() as cur:
            cur.execute("SELECT avatar FROM admins WHERE id = %s LIMIT 1", (user_id,))
            row = cur.fetchone()
            avatar_name = row["avatar"] if row else None
            if isinstance(avatar_name, str) and avatar_name:
                candidate = avatars_dir / Path(avatar_name).name
                if candidate.is_file():
                    path = candidate
                    detected = detect_mime(candidate)
                    if detected.startswith("image/"):
                        mime = detected

    if path:
        resp = send_file(path, mimetype=mime, max_age=86400)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    letter = "U"
    if user_id > 0:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username FROM admins WHERE id = %s LIMIT 1", (user_id,)
            )
            row = cur.fetchone()
            name = str(row["username"] if row and row["username"] else "U")
            letter = name[0].upper() if name else "U"

    from markupsafe import escape

    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
        '<rect width="128" height="128" rx="64" fill="#111111"/>'
        '<text x="64" y="76" text-anchor="middle" font-family="Arial,sans-serif" '
        f'font-size="52" font-weight="700" fill="#ffffff">{escape(letter)}</text></svg>'
    )
    resp = make_response(svg)
    resp.headers["Content-Type"] = "image/svg+xml; charset=utf-8"
    resp.headers["Cache-Control"] = "public, max-age=86400"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@api_bp.route("/notifications.php")
@api_login_required
def notifications():
    since_id = int(request.args.get("since_id") or 0)
    me_id = int(session.get("admin_id") or 0)
    return json_response(notifications_payload(get_db(), me_id, since_id))


@api_bp.route("/unread.php")
@api_login_required
def unread():
    me_id = int(session.get("admin_id") or 0)
    payload = notifications_payload(get_db(), me_id, 0)
    active = 0
    parts = []
    for n in payload["notifications"]:
        if not n.get("is_done"):
            active += 1
        parts.append(
            f"{n['id']}-{n['status']}-{1 if n['is_read'] else 0}"
        )
    return json_response(
        {
            "ok": True,
            "unread": int(payload.get("unread") or 0),
            "active": active,
            "max_id": int(payload.get("max_id") or 0),
            "fingerprint": (
                f"{payload['max_id']}:{payload['unread']}:{active}:{','.join(parts)}"
            ),
        }
    )


@api_bp.route("/mark-notifications.php", methods=["POST", "GET", "PUT", "DELETE", "PATCH"])
@api_login_required
def mark_notifications():
    err = require_method("POST")
    if err:
        return err
    body = read_json_body()
    mark_all = bool(body.get("all"))
    nid = int(body.get("id") or 0)
    me_id = int(session.get("admin_id") or 0)
    conn = get_db()

    with conn.cursor() as cur:
        if mark_all:
            cur.execute(
                "UPDATE notifications n "
                "JOIN access_requests ar ON ar.id = n.access_request_id "
                "JOIN items i ON i.id = ar.item_id "
                "SET n.is_read = 1 "
                "WHERE n.is_read = 0 AND i.admin_id = %s",
                (me_id,),
            )
        elif nid > 0:
            cur.execute(
                "UPDATE notifications n "
                "JOIN access_requests ar ON ar.id = n.access_request_id "
                "JOIN items i ON i.id = ar.item_id "
                "SET n.is_read = 1 "
                "WHERE n.id = %s AND i.admin_id = %s",
                (nid, me_id),
            )
        else:
            return json_response({"ok": False, "error": "Nothing to mark"}, 400)

    return json_response({"ok": True})


@api_bp.route("/clear-done.php", methods=["POST", "GET", "PUT", "DELETE", "PATCH"])
@api_login_required
def clear_done():
    err = require_method("POST")
    if err:
        return err
    body = read_json_body()
    all_flag = bool(body.get("all"))
    notification_id = int(body.get("notification_id") or 0)
    conn = get_db()

    if all_flag:
        cleared = clear_done_access_requests(conn)
        return json_response(
            {"ok": True, "cleared": cleared, "message": "Done requests cleared"}
        )
    if notification_id > 0:
        cleared = clear_done_access_requests(conn, notification_id)
        if cleared < 1:
            return json_response({"ok": False, "error": "Nothing to clear"}, 400)
        return json_response({"ok": True, "cleared": cleared})
    return json_response(
        {"ok": False, "error": "Specify all or notification_id"}, 400
    )


@api_bp.route("/revoke-access.php", methods=["POST", "GET", "PUT", "DELETE", "PATCH"])
@api_login_required
def revoke_access():
    err = require_method("POST")
    if err:
        return err
    body = read_json_body()
    request_id = int(body.get("request_id") or 0)
    item_id = int(body.get("item_id") or 0)
    me_id = int(session.get("admin_id") or 0)
    conn = get_db()

    with conn.cursor() as cur:
        if request_id > 0:
            cur.execute(
                "SELECT ar.item_id "
                "FROM access_requests ar "
                "JOIN items i ON i.id = ar.item_id "
                "WHERE ar.id = %s AND i.admin_id = %s "
                "LIMIT 1",
                (request_id, me_id),
            )
            row = cur.fetchone()
            if not row:
                return json_response({"ok": False, "error": "Nothing to lock"}, 400)
            item_id = int(row["item_id"])
            locked = revoke_active_item_access(conn, item_id)
            if locked < 1:
                return json_response(
                    {
                        "ok": True,
                        "message": "Already locked",
                        "item_id": item_id,
                        "locked": 0,
                    }
                )
            return json_response(
                {
                    "ok": True,
                    "message": "Access locked again",
                    "item_id": item_id,
                    "locked": locked,
                }
            )

        if item_id > 0:
            cur.execute(
                "SELECT id FROM items WHERE id = %s AND admin_id = %s LIMIT 1",
                (item_id, me_id),
            )
            if not cur.fetchone():
                return json_response({"ok": False, "error": "Not allowed"}, 403)
            locked = revoke_active_item_access(conn, item_id)
            return json_response(
                {
                    "ok": True,
                    "message": "All active access for this file is locked",
                    "item_id": item_id,
                    "locked": locked,
                }
            )

    return json_response(
        {"ok": False, "error": "request_id or item_id required"}, 400
    )
