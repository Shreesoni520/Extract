# Shree's Extractions

A private person-to-person file sharing site. Sign up, find people, request timed access to their files, and unlock view/download with a short one-time code.

Built by **Krishna**.

---

## Stack

- **Python / Flask** (app in `server/`)
- **MySQL / MariaDB** (`shrees_extractions`)
- Static UI in `assets/`

---

## Quick start (local)

1. Start **MySQL** in XAMPP.
2. Double-click **`start-site.bat`** (keeps the Python server running).
3. Open: **http://127.0.0.1:5000/Extract/**

Local uploads allow up to **5 GB**. Vercel hosting is limited to about **4 MB** by the platform.

Optional: with Apache running (and proxy enabled), **http://localhost/Extract/** also works. For very large uploads, prefer the `:5000` URL.

---

## What it does

| For members | What happens |
|-------------|--------------|
| **Sign up / Sign in** | Create an account, then use the whole site |
| **Find people** | Search usernames and open someone’s profile |
| **Browse files** | See their active uploads (paged list, 4 per page) |
| **Request access** | Ask for a 6-character unlock code (valid ~5 minutes) |
| **View / Download** | After unlock, access lasts ~5 minutes; owner can lock again anytime |
| **Upload** | Add files with title + description (up to **5 GB** locally; ~4 MB on Vercel) |
| **Protect files** | Require password, hide/show, copy link, lock everyone out, delete |
| **Live requests** | Owner sees access requests with toast + sound, copy code, timers |
| **Account** | Change username, password, and avatar |
| **Theme** | Light / dark mode |

---

## Project layout

```text
Shree's Extractions/
├── server/           Flask app (Python)
├── assets/           CSS, JS, images, sound
├── uploads/          User files + avatars
├── database/         SQL schema
├── favicon.ico
└── README.md
```

---

## Author

Made by **Krishna** — Shree's Extractions.
