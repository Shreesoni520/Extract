"""Notification payload builder — mirrors PHP config/notifications.php."""
from __future__ import annotations

from .helpers import (
    expire_stale_requests,
    seconds_left,
    avatar_url,
)


def notifications_payload(conn, owner_id: int, since_id: int = 0) -> dict:
    expire_stale_requests(conn)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS c "
            "FROM notifications n "
            "JOIN access_requests ar ON ar.id = n.access_request_id "
            "JOIN items i ON i.id = ar.item_id "
            "WHERE n.is_read = 0 AND ar.status IN ('pending', 'unlocked') AND i.admin_id = %s",
            (owner_id,),
        )
        unread = int(cur.fetchone()["c"])

        cur.execute(
            "SELECT COUNT(*) AS c "
            "FROM notifications n "
            "JOIN access_requests ar ON ar.id = n.access_request_id "
            "JOIN items i ON i.id = ar.item_id "
            "WHERE ar.status IN ('used', 'expired') AND i.admin_id = %s",
            (owner_id,),
        )
        done_count = int(cur.fetchone()["c"])

        sql = (
            "SELECT n.id, n.message, n.is_read, n.created_at, n.access_request_id, "
            "       ar.password_plain, ar.status, ar.password_expires_at, ar.unlock_expires_at, "
            "       ar.requester_id, "
            "       i.title AS item_title, i.id AS item_id, "
            "       req.username AS requester_username, req.avatar AS requester_avatar "
            "FROM notifications n "
            "JOIN access_requests ar ON ar.id = n.access_request_id "
            "JOIN items i ON i.id = ar.item_id "
            "LEFT JOIN admins req ON req.id = ar.requester_id "
            "WHERE i.admin_id = %s"
        )
        params: list = [owner_id]
        if since_id > 0:
            sql += " AND n.id > %s"
            params.append(since_id)
        sql += (
            " ORDER BY "
            "  CASE ar.status "
            "    WHEN 'pending' THEN 0 "
            "    WHEN 'unlocked' THEN 1 "
            "    ELSE 2 "
            "  END, "
            "  n.id DESC "
            "LIMIT 40"
        )
        cur.execute(sql, params)
        rows = cur.fetchall()

    notifications = []
    for n in rows:
        status = n["status"]
        is_done = status in ("used", "expired")
        pwd_left = None
        if status == "pending":
            pwd_left = seconds_left(n["password_expires_at"])
        unlock_left = None
        if status == "unlocked" and n["unlock_expires_at"]:
            unlock_left = seconds_left(n["unlock_expires_at"])
        requester_id = int(n["requester_id"] or 0)
        requester_username = (n["requester_username"] or "").strip()
        created = n["created_at"]
        if hasattr(created, "strftime"):
            created = created.strftime("%Y-%m-%d %H:%M:%S")
        notifications.append(
            {
                "id": int(n["id"]),
                "request_id": int(n["access_request_id"]),
                "message": n["message"],
                "is_read": bool(n["is_read"]),
                "created_at": created,
                "password": n["password_plain"],
                "status": status,
                "is_done": is_done,
                "item_title": n["item_title"],
                "item_id": int(n["item_id"]),
                "password_seconds_left": pwd_left,
                "unlock_seconds_left": unlock_left,
                "can_lock": status == "unlocked",
                "requester": {
                    "id": requester_id,
                    "username": requester_username if requester_username else None,
                    "avatar": avatar_url(
                        str(n["requester_avatar"]) if n["requester_avatar"] else None,
                        requester_id,
                    ),
                },
            }
        )

    max_id = 0
    for n in notifications:
        max_id = max(max_id, int(n["id"]))

    return {
        "ok": True,
        "unread": unread,
        "done_count": done_count,
        "notifications": notifications,
        "max_id": max_id,
    }
