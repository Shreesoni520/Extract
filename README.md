# Shree's Extractions

A private person-to-person file sharing site. Sign up, find people, request timed access to their files, and unlock view/download with a short one-time code.

Built by **Krishna**.

---

## Stack

- **Python / Flask** (app in `server/`)
- **MySQL / MariaDB** (`shrees_extractions`)
- Static UI in `assets/`

---

## Quick start

1. Start MySQL in XAMPP.
2. Import `database/shrees_extractions.sql` if the DB is empty.
3. Install and run:

```bat
cd /d C:\xampp\htdocs
python -m pip install -r "Shree's Extractions\server\requirements.txt"
python "Shree's Extractions\server\run.py"
```

4. Open: **http://127.0.0.1:5000/Extract/**

More detail: `server/README.md`

---

## What it does

| For members | What happens |
|-------------|--------------|
| **Sign up / Sign in** | Create an account, then use the whole site |
| **Find people** | Search usernames and open someone’s profile |
| **Browse files** | See their active uploads (paged list, 4 per page) |
| **Request access** | Ask for a 6-character unlock code (valid ~5 minutes) |
| **View / Download** | After unlock, access lasts ~5 minutes; owner can lock again anytime |
| **Upload** | Add files with title + description (up to 50 MB) |
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
