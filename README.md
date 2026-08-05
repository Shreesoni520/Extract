# Shree's Extractions

**Private, person-to-person file sharing with timed access and ephemeral chat.**

Shree's Extractions lets trusted people share files without making them publicly open. Owners upload files, visitors request access, and unlock happens through a short one-time code with a strict time window. An optional private chat exists only for that request — then messages are wiped.

**Live demo:** [https://shrees-extractions.vercel.app](https://shrees-extractions.vercel.app)

Built by **Krishna**.

---

## Overview

Most file hosts are either fully public or fully locked behind a permanent password. This project sits in between:

1. A member uploads a file and can require permission.
2. Another member finds them, opens the file, and requests a password.
3. The owner is notified in real time, can chat, and can share the one-time code.
4. Access lasts about **5 minutes**. The owner can lock everyone out immediately.
5. When the window ends — or the file is locked/deleted — chat and request state are cleared.

The product focus is **control, clarity, and ephemerality**: share when needed, leave nothing lingering.

---

## Features

| Area | What you get |
|------|----------------|
| **Accounts** | Sign up / sign in, username + password, avatar, light/dark theme |
| **People search** | Find other members by username and open their profile |
| **Uploads** | Title, description, password-protected or open files |
| **Timed access** | One-time unlock codes with a ~5 minute request + unlock window |
| **Owner controls** | Approve flow via code, lock again, hide/show, copy link, delete |
| **Live requests** | Toast + sound on the upload page when someone asks for access |
| **Ephemeral chat** | Owner ↔ requester chat during the request window only (150 chars/message) |
| **Large files** | Chunked uploads — up to **1 GB** on Redis storage; up to **5 GB** with S3/R2 |
| **Responsive UI** | Clean landing, browse, upload dashboard, and modal flows for mobile + desktop |

### Access flow

```text
Request password  →  Owner notified  →  Optional chat / share code
        ↓
Visitor unlocks  →  View / download for ~5 minutes
        ↓
Timer ends, lock, or delete  →  Access revoked, chat wiped
```

### Ephemeral chat rules

- Chat appears only **after** a password request exists.
- Messages are capped at **150 characters**.
- Chat lives only for the same **~5 minute** window as the request/unlock.
- Expiry, lock-again, or file delete clears chat data — nothing is kept for later.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, vanilla JavaScript (no SPA framework) |
| Backend | Node.js, Express |
| Auth | Cookie sessions, bcrypt password hashes |
| Production data | Upstash Redis / Vercel KV (JSON document + chunked file storage) |
| Optional local DB | MySQL (XAMPP) via `server/schema.sql` |
| Optional object storage | Cloudflare R2 / S3-compatible (recommended for large video) |
| Hosting | Vercel (Express serverless entry via `index.js`) |

### Why this architecture

- **Express + static HTML** keeps the surface area small and easy to reason about.
- **Redis/KV on Vercel** avoids depending on a suspended Blob store while still supporting real persistence.
- **Chunked uploads** work around serverless body-size limits so larger files can still transfer reliably.
- **Timed access + chat cleanup** encode the privacy model in the product itself, not only in policy text.

---

## Project structure

```text
Extract/
├── index.js                 # Vercel entry — exports the Express app
├── package.json             # Root dependencies + npm scripts
├── vercel.json              # Function config (extended duration for uploads)
├── start-server.bat         # Local Windows helper
├── public/                  # Public static site
│   ├── index.html           # Landing + browse experience
│   ├── download.html        # View / download helper
│   ├── app/                 # Login + register pages
│   └── assets/              # CSS, JS, images, notification sound
├── server/
│   ├── pages/               # Auth-gated upload / account / users pages
│   ├── schema.sql           # MySQL schema for local installs
│   ├── .env.example         # Environment template
│   └── src/                 # API, auth, storage, Redis/S3 adapters
├── scripts/
│   └── clear-db.js          # Wipe production Redis data (maintenance)
├── uploads/                 # Local disk storage (dev only)
└── README.md
```

---

## Getting started (local)

### Requirements

- Node.js 18+
- npm
- Optional: MySQL/XAMPP if you want the SQL path instead of Redis
- Optional: Upstash KV credentials to mirror production storage locally

### 1. Install

```bash
cd Extract
npm install
```

### 2. Configure environment

Copy `server/.env.example` to `server/.env` and set at least:

```env
PORT=3000
SESSION_SECRET=use-a-long-random-string
```

**Local MySQL path**

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASS=
DB_NAME=shrees_extractions
UPLOAD_DIR=../uploads
```

Import the schema once:

```bash
mysql -u root < server/schema.sql
```

**Redis / production-like path**

```env
KV_REST_API_URL=https://xxxx.upstash.io
KV_REST_API_TOKEN=...
SESSION_SECRET=use-a-long-random-string
```

### 3. Run

```bash
npm start
```

Or on Windows: double-click `start-server.bat`.

Open [http://localhost:3000](http://localhost:3000), then **Sign up** to create the first account.

---

## Deploy on Vercel

Production site: **[https://shrees-extractions.vercel.app](https://shrees-extractions.vercel.app)**

### Environment variables

Set these in the Vercel project:

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Cookie session signing (required) |
| `KV_REST_API_URL` | Upstash / Vercel KV REST URL |
| `KV_REST_API_TOKEN` | Upstash / Vercel KV token |
| `S3_*` (optional) | Cloudflare R2 / S3 for 1–5 GB media |
| `BLOB_READ_WRITE_TOKEN` (optional) | Legacy Vercel Blob path |

### Deploy

From the project root:

```bash
npm install
npx vercel --prod
```

Static assets are served from `public/`. Protected member pages are rendered from `server/pages/` only after a valid session.

---

## API surface (high level)

| Area | Examples |
|------|----------|
| Auth | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` |
| Files | Upload (chunked), list, hide/show, lock, delete, download/view |
| Access | Request password, verify code, check access state, revoke / lock again |
| Chat | `GET/POST /api/chat/:requestId` (request participants only, 150-char limit) |
| Account | Username, password, avatar updates |
| Health | `GET /api/health` |

All member actions require an authenticated session cookie.

---

## Security notes

Designed for a **trusted circle** (friends / small private groups), not as a hardened public SaaS.

Already in place:

- Passwords hashed with **bcrypt**
- HttpOnly cookie sessions
- Auth-gated upload/account pages (not just “hidden” static HTML)
- Short-lived unlock codes and unlock windows
- Chat and request cleanup on expire / lock / delete
- File bytes served through controlled API paths, not a public open directory listing

Before a wide public launch, consider: invite-only signup, rate limits, stricter upload allowlists, CSRF hardening, and a custom domain with monitoring.

---

## Maintenance

Wipe production Redis data (accounts, files, requests, chats) when you want a clean slate:

```bash
node scripts/clear-db.js
```

Requires `KV_REST_API_URL` and `KV_REST_API_TOKEN` in `.env.local` or `server/.env`.

---

## Author

**Krishna** — creator of Shree's Extractions.

A full-stack project focused on practical product constraints: serverless uploads, timed permissioning, and ephemeral communication between real people.

- Live: [shrees-extractions.vercel.app](https://shrees-extractions.vercel.app)
