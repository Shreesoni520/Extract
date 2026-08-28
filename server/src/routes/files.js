const express = require('express');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { query, expireStaleRequests } = require('../db');
const { isPreviewable, secondsLeft, avatarUrl, UNLOCK_TTL_SECONDS } = require('../utils');
const { ensureVisitor } = require('../middleware/auth');
const {
  uploadRoot,
  isRemoteUrl,
  isS3Key,
  getSignedDownloadUrl,
  getFileMeta,
  readFileRange,
} = require('../storage');
const { CHUNK_SIZE } = require('../kvStore');

const router = express.Router();

function safeFileName(name) {
  return String(name || 'download').replace(/[\r\n"]/g, '_');
}

function avatarPathInside(avatarsDir, fileName) {
  const base = path.resolve(avatarsDir);
  const leaf = path.basename(String(fileName || ''));
  if (!leaf || leaf === '.' || leaf === '..') return null;
  const resolved = path.resolve(base, leaf);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (resolved !== base && !resolved.startsWith(prefix)) return null;
  return resolved;
}

function parseBytesRange(header, size) {
  if (!header || typeof header !== 'string' || !header.startsWith('bytes=')) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start == null && end == null) return null;
  if (start == null) {
    // suffix: last N bytes
    const n = end;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    if (end == null || end >= size) end = size - 1;
    if (start >= size) return null;
    if (end < start) return null;
  }
  return { start, end };
}

async function streamKvFile(res, filename, item, disposition, rangeHeader) {
  const meta = await getFileMeta(filename);
  const size = meta.size;
  const contentType = item.mime_type || meta.contentType || 'application/octet-stream';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const range = parseBytesRange(rangeHeader, size);
  if (range) {
    const { buffer, start, end } = await readFileRange(filename, range.start, range.end);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }

  // Full download: stream chunk-by-chunk with 1-chunk prefetch (smoother playback/download).
  res.setHeader('Content-Length', size);
  const chunkBytes = meta.chunkBytes || CHUNK_SIZE;
  const totalChunks = meta.chunks || Math.ceil(size / chunkBytes);
  async function* iterate() {
    let pending = null;
    const load = (i) => {
      const from = i * chunkBytes;
      const to = Math.min(size - 1, from + chunkBytes - 1);
      return readFileRange(filename, from, to);
    };
    for (let i = 0; i < totalChunks; i += 1) {
      const part = pending || await load(i);
      pending = i + 1 < totalChunks ? load(i + 1) : null;
      if (part.buffer && part.buffer.length) yield part.buffer;
    }
    if (pending) await pending.catch(() => null);
  }
  return Readable.from(iterate()).pipe(res);
}

async function accessStateForItem(item, visitorToken, viewerId = null) {
  if (!item || Number(item.is_active) === 0) return { status: 'missing' };
  // File owners can always open their own uploads.
  if (viewerId && Number(item.admin_id) === Number(viewerId)) {
    return { status: 'open', can_preview: isPreviewable(item.mime_type) };
  }
  // Only truly public files are open to everyone.
  if (!Number(item.require_password)) {
    return { status: 'open', can_preview: isPreviewable(item.mime_type) };
  }

  // Password files are never "open" for non-owners. Access is personal:
  // only the logged-in user who requested + entered the password.
  if (!viewerId) {
    return { status: 'locked' };
  }

  await expireStaleRequests();

  // Bind to the signed-in requester — not a shared browser cookie.
  const reqs = await query(
    `SELECT * FROM access_requests
     WHERE item_id = :itemId AND requester_id = :viewerId
       AND status IN ('pending', 'unlocked')
     ORDER BY id DESC LIMIT 1`,
    { itemId: item.id, viewerId },
  );
  let req = reqs[0] || null;

  // Legacy fallback: older rows may only have visitor_token.
  // Still require the current browser token, and never share across accounts.
  if (!req && visitorToken) {
    const byToken = await query(
      `SELECT * FROM access_requests
       WHERE item_id = :itemId AND visitor_token = :token
         AND status IN ('pending', 'unlocked')
       ORDER BY id DESC LIMIT 1`,
      { itemId: item.id, token: visitorToken },
    );
    const tokenReq = byToken[0];
    if (tokenReq) {
      const ownerId = tokenReq.requester_id != null ? Number(tokenReq.requester_id) : null;
      if (ownerId == null || ownerId === Number(viewerId)) {
        req = tokenReq;
      }
    }
  }

  if (!req) return { status: 'locked' };

  // If this request belongs to someone else, never grant access.
  if (req.requester_id != null && Number(req.requester_id) !== Number(viewerId)) {
    return { status: 'locked' };
  }

  if (req.status === 'pending') {
    return {
      status: 'pending',
      request_id: req.id,
      seconds_left: secondsLeft(req.password_expires_at),
    };
  }
  const left = secondsLeft(req.unlock_expires_at);
  if (left < 1) {
    await query(`UPDATE access_requests SET status = 'used' WHERE id = :id`, { id: req.id });
    return { status: 'locked' };
  }
  return {
    status: 'unlocked',
    request_id: req.id,
    seconds_left: left,
    can_preview: isPreviewable(item.mime_type),
  };
}

router.get('/download', ensureVisitor, async (req, res) => {
  try {
    await expireStaleRequests();
    const itemId = Number(req.query.item_id || 0);
    const mode = req.query.mode === 'view' ? 'view' : 'download';
    if (itemId < 1) return res.status(400).send('Bad request');

    const rows = await query(
      'SELECT * FROM items WHERE id = :id AND is_active = 1 LIMIT 1',
      { id: itemId },
    );
    const item = rows[0];
    if (!item) return res.status(404).send('Not found');

    if (Number(item.require_password)) {
      const { getSessionUser } = require('../middleware/auth');
      const u = getSessionUser(req);
      // Password files require a signed-in unlock for THIS user only.
      if (!u) {
        return res.status(403).type('text/plain').send('Access locked');
      }
      const st = await accessStateForItem(item, req.visitorToken, u.id);
      if (st.status !== 'unlocked' && st.status !== 'open') {
        return res.status(403).type('text/plain').send('Access locked');
      }
    }

    const view = mode === 'view' && isPreviewable(item.mime_type);
    const disposition = `${view ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeFileName(item.original_name))}"`;

    // S3/R2: redirect to a short-lived signed URL so video/audio seek smoothly (Range on CDN).
    if (isS3Key(item.filename)) {
      const ttl = Number(item.require_password) ? Math.max(60, UNLOCK_TTL_SECONDS) : 3600;
      const signed = await getSignedDownloadUrl(item.filename, ttl);
      return res.redirect(signed);
    }

    // Public http(s) blob URLs: redirect for open files; stream protected ones with Range.
    if (isRemoteUrl(item.filename)) {
      if (!Number(item.require_password)) {
        return res.redirect(item.filename);
      }
      const upstream = await fetch(item.filename, {
        headers: req.headers.range ? { Range: req.headers.range } : {},
      });
      res.status(upstream.status);
      const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      for (const h of pass) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.setHeader('Content-Disposition', disposition);
      res.setHeader('Cache-Control', 'no-store');
      if (!upstream.body) return res.end();
      return Readable.fromWeb(upstream.body).pipe(res);
    }

    if (String(item.filename || '').startsWith('kv://')) {
      return streamKvFile(res, item.filename, item, disposition, req.headers.range);
    }

    const filePath = path.join(uploadRoot(), item.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Not found');
    }

    res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(filePath);
  } catch (err) {
    console.error('download', err);
    return res.status(500).send('Error');
  }
});

router.get('/avatar', async (req, res) => {
  try {
    const rawF = String(req.query.f || '');
    const u = Number(req.query.u || 0);
    const avatarsDir = path.join(uploadRoot(), 'avatars');

    let filePath = null;
    let mime = 'image/png';
    let letter = 'U';

    // Blob/remote avatar URL stored in DB (or passed as f=https://...)
    if (isRemoteUrl(rawF)) {
      return res.redirect(rawF);
    }

    const f = rawF.replace(/[^a-zA-Z0-9._-]/g, '');

    if (f) {
      filePath = avatarPathInside(avatarsDir, f);
      if (filePath && !fs.existsSync(filePath)) filePath = null;
      else {
        const ext = path.extname(f).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.gif') mime = 'image/gif';
        else mime = 'image/png';
      }
    } else if (u > 0) {
      const rows = await query('SELECT username, avatar FROM admins WHERE id = :id LIMIT 1', { id: u });
      const user = rows[0];
      if (user) {
        letter = (user.username || 'U').charAt(0).toUpperCase();
        if (user.avatar) {
          if (isRemoteUrl(user.avatar)) {
            return res.redirect(user.avatar);
          }
          const candidate = avatarPathInside(avatarsDir, user.avatar);
          if (candidate && fs.existsSync(candidate)) {
            filePath = candidate;
            const ext = path.extname(user.avatar).toLowerCase();
            if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
            else if (ext === '.webp') mime = 'image/webp';
            else if (ext === '.gif') mime = 'image/gif';
            else mime = 'image/png';
          }
        }
      }
    }

    if (filePath) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.type(mime).sendFile(filePath);
    }

    const safeLetter = String(letter).replace(/[<>&]/g, '');
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="#111111"/><text x="64" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="52" font-weight="700" fill="#ffffff">${safeLetter}</text></svg>`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('avatar', err);
    return res.status(500).send('Error');
  }
});

module.exports = { router, accessStateForItem, uploadRoot, avatarUrl };
