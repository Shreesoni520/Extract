<p align="center">
  <img src="public/assets/img/favicon.svg" width="72" height="72" alt="Shree's Extractions" />
</p>

<h1 align="center">Shree's Extractions</h1>

<p align="center">
  <strong>Private file sharing for people you trust.</strong><br />
  Request access. Get a one-time code. Chat while the window is open. Then it disappears.
</p>

<p align="center">
  <a href="https://shrees-extractions.vercel.app"><img alt="Live site" src="https://img.shields.io/badge/Live-shrees--extractions.vercel.app-111111?style=for-the-badge" /></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img alt="Express" src="https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img alt="Vercel" src="https://img.shields.io/badge/Vercel-Deployed-black?style=for-the-badge&logo=vercel" />
</p>

---

## The idea

Most file hosts are either wide open or locked behind a password that never expires. This sits in between.

You upload a file. Someone finds you, asks for access, and you get a live ping. Share a short one-time code if you want. They can view or download for about **five minutes**. Optional chat lives only for that same window. Timer ends, you lock it, or you delete the file — access is gone, chat is wiped.

Built for a trusted circle. Not a public drop box.

**Live:** [shrees-extractions.vercel.app](https://shrees-extractions.vercel.app)

---

## Features

| | |
| --- | --- |
| **Accounts** | Sign up, sign in, avatar, light / dark |
| **People search** | Find a username, open their files |
| **Uploads** | Title, description, open or password-gated |
| **Timed access** | One-time code, ~5 minute unlock window |
| **Owner controls** | Lock again, hide, copy link, delete |
| **Live requests** | Toast + sound when someone asks |
| **Ephemeral chat** | Owner + requester only, 150 chars, then gone |
| **Large files** | Chunked uploads — up to 1 GB on Redis, 5 GB with S3 / R2 |

---

## Quick start

```bash
git clone https://github.com/Shreesoni520/Extract.git
cd Extract
npm install
```

Copy `server/.env.example` to `server/.env` and set at least:

```env
PORT=3000
SESSION_SECRET=use-a-long-random-string
```

```bash
npm start
```

On Windows you can also double-click `start-server.bat`. Open [http://localhost:3000](http://localhost:3000) and create an account.

| Script | What it does |
| --- | --- |
| `npm start` | Run the Express app |
| `npm run dev` | Same, with `--watch` |

---

## How it works

```
Sign up  →  upload a file  →  someone requests access
                 │
                 ├─ You get a ping (toast + sound)
                 ├─ Optional chat + one-time code
                 ├─ They unlock for ~5 minutes
                 └─ Timer / lock / delete  →  chat wiped
```

- **Auth** is cookie sessions; passwords are hashed with bcrypt.
- **Production data** lives in Upstash Redis / Vercel KV.
- **Local MySQL** is optional (`server/schema.sql`) if you want SQL instead of Redis.
- **Chunked uploads** get around serverless body-size limits.

There is no public open folder of files. Bytes go through the API after a valid session and an unlock.

---

## Stack

- HTML, CSS, vanilla JavaScript (no SPA framework)
- [Node.js](https://nodejs.org) 18+ + [Express](https://expressjs.com)
- Cookie sessions + [bcryptjs](https://www.npmjs.com/package/bcryptjs)
- Upstash Redis / Vercel KV in production
- Optional MySQL (XAMPP) for local
- Optional Cloudflare R2 / S3 for big media
- [Vercel](https://vercel.com) for deploy (`index.js` is the serverless entry)

---

## License

Private sharing for a trusted circle. Built by **Shree**.
