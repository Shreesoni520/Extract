# Shree's Extractions

A private person-to-person file sharing site. Sign up, find people, request timed access to their files, and unlock view/download with a short one-time code.

Built by **Krishna**.

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

Guests only see the landing page until they sign in or sign up.

---

## How access works

1. Someone finds your file and taps **Need password** (or similar).
2. The site creates a short code and notifies you (on the Upload page).
3. You copy the code and share it with them (chat, etc.).
4. They enter it → unlocked for **5 minutes**.
5. You can **Lock again** to revoke everyone immediately.

Open files (password off) can be opened with a direct link without that flow.

---

## Requirements

- **PHP** 8+ (XAMPP works fine)
- **MySQL** / MariaDB
- Apache with `mod_rewrite` optional (not required for basic use)
- Folder write access for `uploads/`

---

## Quick setup

### 1. Put the project on the server

Example (XAMPP):

```text
C:\xampp\htdocs\Extract
```

URL locally: `http://localhost/Extract/`

### 2. Create the empty database

Import:

```text
database/shrees_extractions.sql
```

That creates the database `shrees_extractions` and all tables (empty — no users yet).

**phpMyAdmin:** Import → choose the file → Go  
**CLI:**

```bash
mysql -u root -p < database/shrees_extractions.sql
```

### 3. Configure database login

Edit `config/config.php`:

```php
'db' => [
    'host' => '127.0.0.1',
    'name' => 'shrees_extractions',
    'user' => 'root',
    'pass' => '',           // set your MySQL password
    'charset' => 'utf8mb4',
],
```

Also check app settings there:

| Setting | Default | Meaning |
|---------|---------|---------|
| `password_ttl_seconds` | `300` | Time to enter the unlock code (5 min) |
| `unlock_ttl_seconds` | `300` | How long unlocked access lasts (5 min) |
| `max_upload_bytes` | 50 MB | Max upload size |
| `upload_dir` | `uploads/` | Where files are stored |
| `notify_email` | `null` | Email alerts (not wired yet) |

### 4. Make uploads writable

Ensure `uploads/` (and `uploads/avatars/`) exist and are writable by PHP.  
The app can create them; `.htaccess` blocks direct public browsing of files.

### 5. First account

Open the site → **Sign up**. That creates your first user. No seed admin in the SQL file.

---

## Important paths

| URL / path | Purpose |
|------------|---------|
| `/Extract/` | Landing + Find people (when logged in) |
| `/Extract/app/` | Upload & manage your files + live requests |
| `/Extract/app/login.php` | Sign in |
| `/Extract/app/register.php` | Sign up |
| `/Extract/app/account.php` | Profile, avatar, password |
| `/Extract/api/*` | JSON APIs (access, download, notifications, etc.) |
| `/Extract/uploads/` | Stored files (not meant to be opened directly) |
| `database/shrees_extractions.sql` | Fresh empty DB schema |

> Paths use `/Extract/` because the project lives in an `Extract` folder. If you put the site at a domain root, those hardcoded paths need updating.

---

## Project layout

```text
Extract/
├── index.php              Public landing + browse
├── favicon.ico
├── app/                   Member pages (upload, login, account…)
├── api/                   Backend endpoints
├── assets/                CSS, JS, images, notify sound
├── config/                config.php, auth, bootstrap, notifications
├── includes/              Nav, theme, favicon, cursor
├── database/              Empty schema SQL + notes
├── uploads/               User files + avatars (keep private)
└── README.md              This file
```

---

## Database tables

| Table | Stores |
|-------|--------|
| `admins` | Users (username, password hash, avatar) |
| `items` | Uploaded files metadata |
| `access_requests` | Unlock codes + pending/unlocked/expired/used status |
| `notifications` | Owner alerts for access requests |

Account passwords are stored hashed (bcrypt). Unlock codes are short-lived and used for the handoff flow.

---

## Features in more detail

### Upload page (`/app/`)
- Dropzone / file pick, title, description  
- Toggle **Need password**  
- Actions: Need password / Copy link / Hide / Delete / Lock again  
- File list with 4-per-page pager  
- Live access-request panel with sound (`assets/sfx/notify.wav`)

### Browse
- Search people (min 2 characters)  
- Profile with avatar + file list  
- Bottom-sheet modal for request → verify → view/download  
- Polling so View/Download stop working when the owner locks again

### Account
- Avatar upload (images, size-limited)  
- Username + password change  

---

## Going live checklist

Good for **friends / small private use** after you:

- [ ] Import `database/shrees_extractions.sql` on the host  
- [ ] Set real DB user/password in `config/config.php`  
- [ ] Use HTTPS  
- [ ] Point the site URL correctly (or update `/Extract/` paths)  
- [ ] Confirm `uploads/` is not publicly listable  
- [ ] Register only people you trust (signup is currently open)

**Not “production hardened” yet** — before a public internet launch, strongly consider:

- Invite-only or approved signup  
- Rate limits on login + password verify  
- CSRF protection on forms/APIs  
- Stronger handling of unlock codes (avoid long-lived plaintext in DB)  
- Upload type allowlist (block executables)  
- Moving secrets out of `config.php` into environment variables  
- Email/push when someone requests access  

Local XAMPP / trusted circle: you’re in good shape. Wide-open public hosting: harden first.

---

## Fresh install vs your current PC

- **This machine:** keep using your existing `shrees_extractions` database with your real data.  
- **New server / reset:** import `database/shrees_extractions.sql`, then sign up again.  
  Re-importing **wipes** that database.

---

## Author

Made by **Krishna** — Shree's Extractions.
