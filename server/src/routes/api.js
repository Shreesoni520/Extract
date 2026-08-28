const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { query, expireStaleRequests, clearDoneForOwner, purgeChatForRequests } = require('../db');

const CHAT_MAX_CHARS = 150;
const {
  formatBytes,
  isPreviewable,
  generatePassword,
  nowSql,
  sqlFromMs,
  secondsLeft,
  parseUsername,
  usernamesMatch,
  usernameTakenMessage,
  avatarUrl,
  randomFilename,
  PASSWORD_TTL_SECONDS,
  UNLOCK_TTL_SECONDS,
  PASSWORD_MIN_LENGTH,
  MAX_UPLOAD_BYTES,
  KV_UPLOAD_MAX_BYTES,
} = require('../utils');
const {
  requireAuth,
  ensureVisitor,
  getSessionUser,
  setSessionUser,
} = require('../middleware/auth');
const { accessStateForItem } = require('./files');
const {
  useBlob,
  useKv,
  useS3,
  uploadRoot,
  saveFile,
  deleteFile,
  effectiveMaxUploadBytes,
  storageMode,
} = require('../storage');
const {
  saveUploadMeta,
  loadUploadMeta,
  CLIENT_CHUNK_BYTES,
} = require('../kvStore');
const {
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  PART_SIZE,
} = require('../s3Store');
const crypto = require('crypto');

const router = express.Router();

const uploadsDir = uploadRoot();
const avatarsDir = path.join(uploadsDir, 'avatars');
const useRemoteStorage = !!(useKv() || useBlob() || process.env.VERCEL);

if (!useRemoteStorage) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    if (req.uploadKind === 'avatar') cb(null, avatarsDir);
    else cb(null, uploadsDir);
  },
  filename(req, file, cb) {
    cb(null, randomFilename(file.originalname));
  },
});

const upload = multer({
  storage: useRemoteStorage ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const avatarUpload = multer({
  storage: useRemoteStorage
    ? multer.memoryStorage()
    : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, avatarsDir),
      filename: (_req, file, cb) => cb(null, randomFilename(file.originalname)),
    }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    const mime = String(file.mimetype || '').toLowerCase();
    if (allowed.includes(mime) || (okExt && (!mime || mime === 'application/octet-stream'))) {
      return cb(null, true);
    }
    return cb(new Error('Use JPG, PNG, WEBP, or GIF.'));
  },
});

async function usernameTaken(username, exceptId = null) {
  const rows = await query('SELECT id, username FROM admins');
  for (const u of rows) {
    if (exceptId != null && Number(u.id) === Number(exceptId)) continue;
    if (usernamesMatch(username, u.username)) return true;
  }
  return false;
}

async function revokeActiveItemAccess(itemId) {
  const active = await query(
    `SELECT id FROM access_requests
     WHERE item_id = :itemId AND status IN ('pending', 'unlocked')`,
    { itemId },
  );
  const result = await query(
    `UPDATE access_requests
     SET status = 'used', unlock_expires_at = NOW()
     WHERE item_id = :itemId AND status IN ('pending', 'unlocked')`,
    { itemId },
  );
  const ids = (active || []).map((r) => Number(r.id)).filter((n) => n > 0);
  if (ids.length && typeof purgeChatForRequests === 'function') {
    await purgeChatForRequests(ids);
  } else {
    for (const id of ids) {
      try {
        await query('DELETE FROM chat_messages WHERE access_request_id = :requestId', { requestId: id });
      } catch (_) {}
    }
  }
  return result.affectedRows || 0;
}

async function loadChatSession(requestId) {
  const rows = await query(
    `SELECT ar.id, ar.item_id, ar.requester_id, ar.status,
            ar.password_expires_at, ar.unlock_expires_at,
            i.admin_id, i.title AS item_title
     FROM access_requests ar
     JOIN items i ON i.id = ar.item_id
     WHERE ar.id = :id LIMIT 1`,
    { id: requestId },
  );
  return rows[0] || null;
}

function chatSecondsLeft(ar) {
  if (!ar) return 0;
  if (ar.status === 'pending') return secondsLeft(ar.password_expires_at);
  if (ar.status === 'unlocked') return secondsLeft(ar.unlock_expires_at);
  return 0;
}

async function findItem(itemId) {
  const rows = await query('SELECT * FROM items WHERE id = :id LIMIT 1', { id: itemId });
  const item = rows[0] || null;
  if (!item) return null;
  // Missing is_active should not hide the file (treat as active).
  if (Number(item.is_active) === 0) return null;
  return item;
}

async function findOwnedItem(itemId, ownerId) {
  const rows = await query('SELECT * FROM items WHERE id = :id LIMIT 1', { id: itemId });
  const item = rows[0] || null;
  if (!item || Number(item.admin_id) !== Number(ownerId)) return null;
  return item;
}

async function notificationsPayload(ownerId, sinceId) {
  await expireStaleRequests();

  const unreadRows = await query(
    `SELECT COUNT(*) AS c
     FROM notifications n
     JOIN access_requests ar ON ar.id = n.access_request_id
     JOIN items i ON i.id = ar.item_id
     WHERE n.is_read = 0
       AND ar.status IN ('pending', 'unlocked')
       AND i.admin_id = :ownerId`,
    { ownerId },
  );
  const doneRows = await query(
    `SELECT COUNT(*) AS c
     FROM notifications n
     JOIN access_requests ar ON ar.id = n.access_request_id
     JOIN items i ON i.id = ar.item_id
     WHERE ar.status IN ('used', 'expired')
       AND i.admin_id = :ownerId`,
    { ownerId },
  );

  let rows = await query(
    `SELECT n.id AS n_id, n.message, n.is_read, n.created_at AS n_created,
            ar.id AS request_id, ar.password_plain, ar.status, ar.password_expires_at,
            ar.unlock_expires_at, ar.requester_id,
            i.id AS item_id, i.title AS item_title,
            a.username AS requester_username, a.avatar AS requester_avatar
     FROM notifications n
     JOIN access_requests ar ON ar.id = n.access_request_id
     JOIN items i ON i.id = ar.item_id
     LEFT JOIN admins a ON a.id = ar.requester_id
     WHERE i.admin_id = :ownerId
       ${sinceId > 0 ? 'AND n.id > :sinceId' : ''}
     ORDER BY FIELD(ar.status, 'pending', 'unlocked', 'used', 'expired'), n.id DESC
     LIMIT 40`,
    sinceId > 0 ? { ownerId, sinceId } : { ownerId },
  );

  const notifications = rows.map((row) => {
    const isDone = row.status === 'used' || row.status === 'expired';
    let pwdLeft = null;
    if (row.status === 'pending') pwdLeft = secondsLeft(row.password_expires_at);
    let unlockLeft = null;
    if (row.status === 'unlocked' && row.unlock_expires_at) {
      unlockLeft = secondsLeft(row.unlock_expires_at);
    }
    const requesterId = row.requester_id || 0;
    return {
      id: row.n_id,
      request_id: row.request_id,
      message: row.message,
      is_read: !!row.is_read,
      created_at: row.n_created,
      password: row.password_plain,
      status: row.status,
      is_done: isDone,
      item_title: row.item_title,
      item_id: row.item_id,
      password_seconds_left: pwdLeft,
      unlock_seconds_left: unlockLeft,
      can_lock: row.status === 'unlocked' || row.status === 'pending',
      requester: {
        id: requesterId,
        username: row.requester_username || null,
        avatar: avatarUrl(row.requester_avatar, requesterId),
      },
    };
  });

  const maxId = notifications.reduce((m, x) => Math.max(m, x.id), 0);
  return {
    ok: true,
    unread: Number(unreadRows[0]?.c || 0),
    done_count: Number(doneRows[0]?.c || 0),
    notifications,
    max_id: maxId,
  };
}

// ——— Public / member ———

router.get('/users', requireAuth, ensureVisitor, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const queryStr = String(req.query.q || '').trim();
    const minLen = 2;
    if (!queryStr || queryStr.length < minLen) {
      return res.json({ ok: true, query: queryStr, min_length: minLen, users: [] });
    }
    const like = `%${queryStr.toLowerCase()}%`;
    const users = await query(
      `SELECT a.id, a.username, a.avatar, a.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.admin_id = a.id AND i.is_active = 1) AS file_count
       FROM admins a
       WHERE a.id <> :meId AND LOWER(a.username) LIKE :like
       ORDER BY a.username ASC
       LIMIT 40`,
      { meId: me.id, like },
    );
    return res.json({
      ok: true,
      query: queryStr,
      min_length: minLen,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        avatar: avatarUrl(u.avatar, u.id),
        file_count: Number(u.file_count || 0),
        created_at: u.created_at,
      })),
    });
  } catch (err) {
    console.error('users', err);
    return res.status(500).json({ ok: false, error: 'Search failed' });
  }
});

router.get('/items', requireAuth, ensureVisitor, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const userId = Number(req.query.user_id || 0);
    if (userId < 1) return res.status(400).json({ ok: false, error: 'user_id required' });

    const uploaderRows = await query('SELECT id, username, avatar FROM admins WHERE id = :id LIMIT 1', { id: userId });
    const uploader = uploaderRows[0];
    const items = await query(
      `SELECT * FROM items WHERE admin_id = :userId AND is_active = 1 ORDER BY created_at DESC, id DESC`,
      { userId },
    );

    const out = [];
    for (const item of items) {
      const access = await accessStateForItem(item, req.visitorToken, me && me.id);
      out.push({
        id: item.id,
        title: item.title,
        description: item.description,
        uploader: uploader ? uploader.username : 'unknown',
        uploader_id: userId,
        uploader_avatar: avatarUrl(uploader && uploader.avatar, userId),
        require_password: !!Number(item.require_password),
        mime_type: item.mime_type,
        file_size: formatBytes(item.file_size),
        original_name: item.original_name,
        created_at: item.created_at,
        access,
      });
    }
    return res.json({ ok: true, user_id: userId, items: out });
  } catch (err) {
    console.error('items', err);
    return res.status(500).json({ ok: false, error: 'Could not load items' });
  }
});

router.get('/check-access', requireAuth, ensureVisitor, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const itemId = Number(req.query.item_id || 0);
    if (itemId < 1) return res.status(400).json({ ok: false, error: 'item_id required' });
    const item = await findItem(itemId);
    if (!item) return res.json({ ok: true, status: 'missing' });
    const st = await accessStateForItem(item, req.visitorToken, me && me.id);
    const out = { ok: true, status: st.status };
    if (st.request_id != null) out.request_id = st.request_id;
    if (st.seconds_left != null) out.seconds_left = st.seconds_left;
    if (st.can_preview != null) out.can_preview = st.can_preview;
    return res.json(out);
  } catch (err) {
    console.error('check-access', err);
    return res.status(500).json({ ok: false, error: 'Check failed' });
  }
});

router.post('/request-access', requireAuth, ensureVisitor, async (req, res) => {
  try {
    await expireStaleRequests();
    const itemId = Number((req.body && req.body.item_id) || 0);
    const item = await findItem(itemId);
    if (!item) return res.status(400).json({ ok: false, error: 'Item not found' });
    if (!Number(item.require_password)) {
      return res.status(400).json({ ok: false, error: 'This file is open — no password needed' });
    }

    const me = getSessionUser(req);
    if (me && Number(item.admin_id) === Number(me.id)) {
      return res.json({
        ok: true,
        status: 'open',
        message: 'This is your file — no password needed.',
      });
    }

    const token = req.visitorToken;
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing visitor session. Refresh and try again.' });
    }
    if (!me || !me.id) {
      return res.status(401).json({ ok: false, error: 'Sign in to request access.' });
    }

    // Who receives this request? Always the file uploader (item.admin_id).
    const ownerRows = await query(
      'SELECT id, username, avatar FROM admins WHERE id = :id LIMIT 1',
      { id: item.admin_id },
    );
    const owner = ownerRows[0];
    const ownerName = owner && owner.username ? `@${owner.username}` : 'the file owner';

    // Existing personal request for THIS signed-in user only.
    let existingRows = await query(
      `SELECT * FROM access_requests
       WHERE item_id = :itemId AND requester_id = :viewerId
         AND status IN ('pending', 'unlocked')
       ORDER BY id DESC LIMIT 1`,
      { itemId, viewerId: me.id },
    );
    if (!existingRows[0]) {
      existingRows = await query(
        `SELECT * FROM access_requests
         WHERE item_id = :itemId AND visitor_token = :token
           AND status IN ('pending', 'unlocked')
         ORDER BY id DESC LIMIT 1`,
        { itemId, token },
      );
      // Never reuse another account's request from a shared browser cookie.
      if (existingRows[0] && existingRows[0].requester_id != null
        && Number(existingRows[0].requester_id) !== Number(me.id)) {
        existingRows = [];
      }
    }

    const existing = existingRows[0];
    if (existing) {
      if (existing.status === 'pending') {
        return res.json({
          ok: true,
          status: 'pending',
          request_id: existing.id,
          seconds_left: secondsLeft(existing.password_expires_at),
          owner_username: owner && owner.username ? owner.username : null,
          message: `Password already requested from ${ownerName}. Enter it within the time window.`,
        });
      }
      return res.json({
        ok: true,
        status: 'unlocked',
        request_id: existing.id,
        seconds_left: secondsLeft(existing.unlock_expires_at),
        owner_username: owner && owner.username ? owner.username : null,
        message: 'You already have active access on your account.',
      });
    }

    const password = generatePassword(6);
    const passwordExpires = sqlFromMs(Date.now() + PASSWORD_TTL_SECONDS * 1000);
    const insert = await query(
      `INSERT INTO access_requests
       (item_id, visitor_token, requester_id, password_plain, status, password_expires_at)
       VALUES (:itemId, :token, :requesterId, :password, 'pending', :expires)`,
      {
        itemId,
        token,
        requesterId: me.id,
        password,
        expires: passwordExpires,
      },
    );
    const who = `@${me.username}`;
    const msg = `${who} requested access to "${item.title}" — password: ${password}`;
    await query(
      `INSERT INTO notifications (access_request_id, message) VALUES (:reqId, :message)`,
      { reqId: insert.insertId, message: msg.slice(0, 255) },
    );
    return res.json({
      ok: true,
      status: 'pending',
      request_id: insert.insertId,
      seconds_left: PASSWORD_TTL_SECONDS,
      owner_id: owner ? Number(owner.id) : Number(item.admin_id),
      owner_username: owner && owner.username ? owner.username : null,
      message: `Request sent to ${ownerName}. Ask them for the password, then enter it here within 5 minutes.`,
    });
  } catch (err) {
    console.error('request-access', err);
    return res.status(500).json({ ok: false, error: 'Request failed' });
  }
});

router.post('/verify-password', requireAuth, ensureVisitor, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const itemId = Number((req.body && req.body.item_id) || 0);
    const pwd = String((req.body && req.body.password) || '').toUpperCase().trim();
    if (itemId < 1 || !pwd) {
      return res.status(400).json({ ok: false, error: 'Item and password are required' });
    }

    // Unlock only THIS user's pending request — never another person's.
    let rows = await query(
      `SELECT * FROM access_requests
       WHERE item_id = :itemId AND requester_id = :viewerId AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      { itemId, viewerId: me.id },
    );
    if (!rows[0] && req.visitorToken) {
      rows = await query(
        `SELECT * FROM access_requests
         WHERE item_id = :itemId AND visitor_token = :token AND status = 'pending'
         ORDER BY id DESC LIMIT 1`,
        { itemId, token: req.visitorToken },
      );
      // If that request belongs to someone else, reject.
      if (rows[0] && rows[0].requester_id != null && Number(rows[0].requester_id) !== Number(me.id)) {
        rows = [];
      }
    }

    const reqRow = rows[0];
    if (!reqRow) {
      return res.status(400).json({ ok: false, error: 'No active password request. Request access first.' });
    }
    if (secondsLeft(reqRow.password_expires_at) < 1) {
      await query(`UPDATE access_requests SET status = 'expired' WHERE id = :id`, { id: reqRow.id });
      return res.status(410).json({ ok: false, error: 'Password expired. Request a new one.' });
    }
    if (String(reqRow.password_plain).toUpperCase() !== pwd) {
      return res.status(403).json({ ok: false, error: 'Wrong password' });
    }

    // Stamp requester_id so unlock stays bound to this account only.
    const unlockExpires = sqlFromMs(Date.now() + UNLOCK_TTL_SECONDS * 1000);
    await query(
      `UPDATE access_requests
       SET status = 'unlocked', unlocked_at = NOW(), unlock_expires_at = :expires,
           requester_id = :viewerId, visitor_token = :token
       WHERE id = :id`,
      {
        id: reqRow.id,
        expires: unlockExpires,
        viewerId: me.id,
        token: req.visitorToken || reqRow.visitor_token,
      },
    );
    return res.json({
      ok: true,
      status: 'unlocked',
      request_id: reqRow.id,
      seconds_left: UNLOCK_TTL_SECONDS,
      message: 'Unlocked for your account only. You have 5 minutes.',
    });
  } catch (err) {
    console.error('verify-password', err);
    return res.status(500).json({ ok: false, error: 'Unlock failed' });
  }
});

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const sinceId = Number(req.query.since_id || 0);
    const payload = await notificationsPayload(me.id, sinceId);
    return res.json(payload);
  } catch (err) {
    console.error('notifications', err);
    return res.status(500).json({ ok: false, error: 'Could not load notifications' });
  }
});

router.get('/unread', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const payload = await notificationsPayload(me.id, 0);
    let active = 0;
    const parts = [];
    for (const n of payload.notifications) {
      if (!n.is_done) active += 1;
      parts.push(`${n.id}-${n.status}-${n.is_read ? '1' : '0'}`);
    }
    return res.json({
      ok: true,
      unread: payload.unread,
      done_count: payload.done_count,
      active,
      max_id: payload.max_id,
      fingerprint: `${payload.max_id}:${payload.unread}:${active}:${parts.join(',')}`,
    });
  } catch (err) {
    console.error('unread', err);
    return res.status(500).json({ ok: false, error: 'Could not load unread' });
  }
});

router.post('/mark-notifications', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const all = !!(req.body && req.body.all);
    const id = Number((req.body && req.body.id) || 0);
    if (all) {
      await query(
        `UPDATE notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         SET n.is_read = 1
         WHERE i.admin_id = :ownerId AND n.is_read = 0`,
        { ownerId: me.id },
      );
      return res.json({ ok: true });
    }
    if (id > 0) {
      const rows = await query(
        `SELECT n.id FROM notifications n
         JOIN access_requests ar ON ar.id = n.access_request_id
         JOIN items i ON i.id = ar.item_id
         WHERE n.id = :id AND i.admin_id = :ownerId LIMIT 1`,
        { id, ownerId: me.id },
      );
      if (!rows[0]) return res.status(400).json({ ok: false, error: 'Nothing to mark' });
      await query('UPDATE notifications SET is_read = 1 WHERE id = :id', { id });
      return res.json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: 'Nothing to mark' });
  } catch (err) {
    console.error('mark-notifications', err);
    return res.status(500).json({ ok: false, error: 'Could not mark' });
  }
});

router.get('/chat/:requestId', requireAuth, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const requestId = Number(req.params.requestId || 0);
    if (requestId < 1) return res.status(400).json({ ok: false, error: 'Bad request' });

    const ar = await loadChatSession(requestId);
    if (!ar) return res.status(404).json({ ok: false, error: 'Chat not found' });

    const isOwner = Number(ar.admin_id) === Number(me.id);
    const isRequester = Number(ar.requester_id) === Number(me.id);
    if (!isOwner && !isRequester) {
      return res.status(403).json({ ok: false, error: 'Not allowed' });
    }

    const active = ar.status === 'pending' || ar.status === 'unlocked';
    const left = chatSecondsLeft(ar);
    if (!active || left < 1) {
      try {
        await query('DELETE FROM chat_messages WHERE access_request_id = :requestId', { requestId });
      } catch (_) {}
      return res.json({
        ok: true,
        closed: true,
        can_send: false,
        seconds_left: 0,
        max_chars: CHAT_MAX_CHARS,
        messages: [],
        peer_username: null,
        item_title: ar.item_title || 'File',
      });
    }

    let peerUsername = null;
    if (isOwner && ar.requester_id) {
      const peers = await query('SELECT id, username FROM admins WHERE id = :id LIMIT 1', { id: ar.requester_id });
      peerUsername = peers[0] ? peers[0].username : null;
    } else if (isRequester) {
      const peers = await query('SELECT id, username FROM admins WHERE id = :id LIMIT 1', { id: ar.admin_id });
      peerUsername = peers[0] ? peers[0].username : null;
    }

    const messages = await query(
      `SELECT cm.id, cm.access_request_id, cm.sender_id, cm.body, cm.created_at, a.username AS sender_username
       FROM chat_messages cm
       LEFT JOIN admins a ON a.id = cm.sender_id
       WHERE cm.access_request_id = :requestId
       ORDER BY cm.id ASC`,
      { requestId },
    );

    return res.json({
      ok: true,
      closed: false,
      can_send: true,
      seconds_left: left,
      max_chars: CHAT_MAX_CHARS,
      request_id: requestId,
      item_title: ar.item_title || 'File',
      peer_username: peerUsername,
      me_id: me.id,
      messages: (messages || []).map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        body: m.body,
        created_at: m.created_at,
        sender_username: m.sender_username || null,
        mine: Number(m.sender_id) === Number(me.id),
      })),
    });
  } catch (err) {
    console.error('chat get', err);
    return res.status(500).json({ ok: false, error: 'Could not load chat' });
  }
});

router.post('/chat/:requestId', requireAuth, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const requestId = Number(req.params.requestId || 0);
    const body = String((req.body && req.body.body) || '').trim();
    if (requestId < 1) return res.status(400).json({ ok: false, error: 'Bad request' });
    if (!body) return res.status(400).json({ ok: false, error: 'Type a message first.' });
    if (body.length > CHAT_MAX_CHARS) {
      return res.status(400).json({
        ok: false,
        error: `Messages can be at most ${CHAT_MAX_CHARS} characters.`,
      });
    }

    const ar = await loadChatSession(requestId);
    if (!ar) return res.status(404).json({ ok: false, error: 'Chat not found' });

    const isOwner = Number(ar.admin_id) === Number(me.id);
    const isRequester = Number(ar.requester_id) === Number(me.id);
    if (!isOwner && !isRequester) {
      return res.status(403).json({ ok: false, error: 'Not allowed' });
    }

    const left = chatSecondsLeft(ar);
    if (!['pending', 'unlocked'].includes(ar.status) || left < 1) {
      try {
        await query('DELETE FROM chat_messages WHERE access_request_id = :requestId', { requestId });
      } catch (_) {}
      return res.status(400).json({
        ok: false,
        closed: true,
        error: 'This chat has ended. The request timer finished or access was locked.',
      });
    }

    await query(
      `INSERT INTO chat_messages (access_request_id, sender_id, body)
       VALUES (:requestId, :senderId, :body)`,
      { requestId, senderId: me.id, body },
    );

    return res.json({ ok: true, message: 'Sent' });
  } catch (err) {
    console.error('chat post', err);
    return res.status(500).json({ ok: false, error: 'Could not send message' });
  }
});

router.post('/revoke-access', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const requestId = Number((req.body && req.body.request_id) || 0);
    const itemId = Number((req.body && req.body.item_id) || 0);

    let targetItemId = 0;

    if (requestId > 0) {
      // Prefer a simple lookup (works on MySQL + Redis JSON DB).
      const arRows = await query('SELECT * FROM access_requests WHERE id = :id LIMIT 1', { id: requestId });
      const ar = arRows[0];
      if (!ar) {
        return res.status(400).json({ ok: false, error: 'Nothing to lock' });
      }
      const item = await findItem(ar.item_id);
      if (!item || Number(item.admin_id) !== Number(me.id)) {
        return res.status(400).json({ ok: false, error: 'Nothing to lock' });
      }
      targetItemId = Number(item.id);
    } else if (itemId > 0) {
      const item = await findItem(itemId);
      if (!item || Number(item.admin_id) !== Number(me.id)) {
        return res.status(400).json({ ok: false, error: 'Not allowed' });
      }
      targetItemId = Number(item.id);
    } else {
      return res.status(400).json({ ok: false, error: 'request_id or item_id required' });
    }

    const locked = await revokeActiveItemAccess(targetItemId);
    return res.json({
      ok: true,
      message: locked > 0 ? 'Access locked again' : 'Already locked',
      item_id: targetItemId,
      locked,
    });
  } catch (err) {
    console.error('revoke-access', err);
    return res.status(500).json({ ok: false, error: 'Could not revoke' });
  }
});

router.post('/clear-done', requireAuth, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const all = !!(req.body && req.body.all);
    const notificationId = Number((req.body && req.body.notification_id) || 0);

    // Prefer atomic clear on Redis/JSON DB (avoids merge restoring the last deleted row).
    if (typeof clearDoneForOwner === 'function') {
      if (all) {
        const result = await clearDoneForOwner(me.id, null);
        return res.json({
          ok: true,
          cleared: Number((result && result.affectedRows) || 0),
          message: 'Done requests cleared',
        });
      }
      if (notificationId > 0) {
        const payload = await notificationsPayload(me.id, 0);
        const note = (payload.notifications || []).find(
          (n) => Number(n.id) === notificationId && n.is_done && n.request_id,
        );
        if (!note) {
          return res.status(400).json({ ok: false, error: 'Nothing to clear' });
        }
        const result = await clearDoneForOwner(me.id, note.request_id);
        if (!result || !result.affectedRows) {
          return res.status(400).json({ ok: false, error: 'Nothing to clear' });
        }
        return res.json({ ok: true, cleared: 1 });
      }
      return res.status(400).json({ ok: false, error: 'Specify all or notification_id' });
    }

    // MySQL fallback
    const payload = await notificationsPayload(me.id, 0);
    const done = (payload.notifications || []).filter((n) => n.is_done && n.request_id);
    if (all) {
      let cleared = 0;
      for (const n of done) {
        const result = await query('DELETE FROM access_requests WHERE id = :id', { id: n.request_id });
        cleared += Number((result && result.affectedRows) || 0);
      }
      return res.json({ ok: true, cleared, message: 'Done requests cleared' });
    }
    if (notificationId > 0) {
      const note = done.find((n) => Number(n.id) === notificationId);
      if (!note) return res.status(400).json({ ok: false, error: 'Nothing to clear' });
      await query('DELETE FROM access_requests WHERE id = :id', { id: note.request_id });
      return res.json({ ok: true, cleared: 1 });
    }
    return res.status(400).json({ ok: false, error: 'Specify all or notification_id' });
  } catch (err) {
    console.error('clear-done', err);
    return res.status(500).json({ ok: false, error: 'Could not clear' });
  }
});

// ——— Owner ———

router.get('/my-items', requireAuth, async (req, res) => {
  try {
    await expireStaleRequests();
    const me = getSessionUser(req);
    const items = await query(
      `SELECT i.*,
              (SELECT COUNT(*) FROM access_requests ar
               WHERE ar.item_id = i.id AND ar.status = 'unlocked') AS unlocked_count
       FROM items i
       WHERE i.admin_id = :adminId
       ORDER BY i.created_at DESC, i.id DESC`,
      { adminId: me.id },
    );
    return res.json({
      ok: true,
      items: items.map((item) => ({
        ...item,
        require_password: !!item.require_password,
        is_active: Number(item.is_active) !== 0,
        uploader: me.username,
        unlocked_count: Number(item.unlocked_count || 0),
      })),
    });
  } catch (err) {
    console.error('my-items', err);
    return res.status(500).json({ ok: false, error: 'Could not load items' });
  }
});

// On Vercel/remote storage, keep single-request uploads under the ~4.5 MB body cap.
// Local disk can accept large files in one go. Huge files should use S3/R2 or chunks.
const DIRECT_UPLOAD_MAX = useRemoteStorage
  ? Math.min(effectiveMaxUploadBytes(), 3.5 * 1024 * 1024)
  : Math.min(effectiveMaxUploadBytes(), 200 * 1024 * 1024);

router.get('/upload/config', requireAuth, (_req, res) => {
  const maxBytes = effectiveMaxUploadBytes();
  return res.json({
    ok: true,
    mode: storageMode(),
    max_bytes: maxBytes,
    max_label: formatBytes(maxBytes),
    s3: useS3(),
    kv: useKv(),
    blob: useBlob(),
    part_size: useS3() ? PART_SIZE : CLIENT_CHUNK_BYTES,
  });
});

router.post('/upload', requireAuth, (req, res) => {
  req.uploadKind = 'file';
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE' || /large|limit/i.test(err.message || '');
      return res.status(tooBig ? 413 : 400).json({
        ok: false,
        error: tooBig
          ? 'File is too large for a single upload. The app will retry in parts automatically — refresh and try again.'
          : (err.message || 'Upload failed'),
        code: tooBig ? 'TOO_LARGE' : 'UPLOAD_ERROR',
      });
    }
    try {
      const me = getSessionUser(req);
      const title = String((req.body && req.body.title) || '').trim();
      const description = String((req.body && req.body.description) || '').trim() || null;
      const requirePasswordRaw = req.body && req.body.require_password;
      const requirePassword = requirePasswordRaw === '1' || requirePasswordRaw === 'true' || requirePasswordRaw === true || requirePasswordRaw === 'on';

      if (!title) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ ok: false, error: 'Title is required.' });
      }
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Choose a file to upload.' });
      }
      if (req.file.size > effectiveMaxUploadBytes()) {
        if (req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          ok: false,
          error: `File is too large (max ${formatBytes(effectiveMaxUploadBytes())}).`,
        });
      }
      if (useRemoteStorage && req.file.size > DIRECT_UPLOAD_MAX) {
        if (req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(413).json({
          ok: false,
          error: 'File too large for direct upload. Use chunked upload.',
          code: 'USE_CHUNKED',
          chunk_bytes: CLIENT_CHUNK_BYTES,
        });
      }

      const storedName = req.file.filename || randomFilename(req.file.originalname);
      let filename = storedName;
      if (useRemoteStorage) {
        const source = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
        if (!source) {
          return res.status(400).json({ ok: false, error: 'Choose a file to upload.' });
        }
        const saved = await saveFile(source, {
          filename: storedName,
          contentType: req.file.mimetype || 'application/octet-stream',
        });
        filename = saved.filename;
        if (req.file.path) fs.unlink(req.file.path, () => {});
      }

      const inserted = await query(
        `INSERT INTO items
         (admin_id, title, description, filename, original_name, mime_type, file_size, require_password, is_active)
         VALUES (:adminId, :title, :description, :filename, :originalName, :mime, :size, :requirePassword, 1)`,
        {
          adminId: me.id,
          title,
          description,
          filename,
          originalName: req.file.originalname,
          mime: req.file.mimetype || 'application/octet-stream',
          size: req.file.size,
          requirePassword: requirePassword ? 1 : 0,
        },
      );
      const insertId = Number((inserted && inserted.insertId) || 0);
      return res.json({
        ok: true,
        message: 'File uploaded.',
        item: {
          id: insertId,
          title,
          description,
          filename,
          original_name: req.file.originalname,
          mime_type: req.file.mimetype || 'application/octet-stream',
          file_size: req.file.size,
          require_password: !!requirePassword,
          is_active: true,
          uploader: me.username,
          unlocked_count: 0,
        },
      });
    } catch (e) {
      console.error('upload', e);
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ ok: false, error: 'Upload failed.' });
    }
  });
});

router.post('/upload/init', requireAuth, async (req, res) => {
  try {
    if (!useKv() && !useBlob() && !useS3() && process.env.VERCEL) {
      return res.status(500).json({
        ok: false,
        error: 'Storage is not configured. Redis, Blob, or R2 must be connected on Vercel.',
      });
    }
    const me = getSessionUser(req);
    const title = String((req.body && req.body.title) || '').trim();
    const description = String((req.body && req.body.description) || '').trim() || null;
    const requirePasswordRaw = req.body && req.body.require_password;
    const requirePassword = requirePasswordRaw === '1' || requirePasswordRaw === true || requirePasswordRaw === 'true' || requirePasswordRaw === 'on';
    const originalName = String((req.body && req.body.original_name) || 'file').slice(0, 180);
    const mime = String((req.body && req.body.mime_type) || 'application/octet-stream').slice(0, 120);
    const size = Number((req.body && req.body.size) || 0);

    if (!title) return res.status(400).json({ ok: false, error: 'Title is required.' });
    if (!Number.isFinite(size) || size < 1) {
      return res.status(400).json({ ok: false, error: 'Choose a file to upload.' });
    }
    const maxBytes = effectiveMaxUploadBytes();
    if (size > maxBytes) {
      return res.status(400).json({
        ok: false,
        error: `File is too large (max ${formatBytes(maxBytes)}).`,
      });
    }
    if (!useS3() && useKv() && size > KV_UPLOAD_MAX_BYTES) {
      return res.status(400).json({
        ok: false,
        error: `File is too large for Redis storage (max ${formatBytes(KV_UPLOAD_MAX_BYTES)}). Add Cloudflare R2 for bigger files.`,
      });
    }

    const chunkBytes = CLIENT_CHUNK_BYTES;
    const chunks = Math.ceil(size / chunkBytes);
    const uploadId = crypto.randomBytes(16).toString('hex');
    const storedName = randomFilename(originalName);

    await saveUploadMeta(uploadId, {
      userId: me.id,
      title,
      description,
      requirePassword: !!requirePassword,
      originalName,
      mime,
      size,
      chunks,
      chunkBytes,
      storedName,
      received: {},
      createdAt: Date.now(),
    });

    return res.json({
      ok: true,
      upload_id: uploadId,
      chunk_bytes: chunkBytes,
      chunks,
    });
  } catch (err) {
    console.error('upload/init', err);
    return res.status(500).json({ ok: false, error: 'Could not start upload.' });
  }
});

router.post('/upload/chunk', requireAuth, (req, res) => {
  req.uploadKind = 'file';
  upload.single('chunk')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Chunk upload failed' });
    }
    try {
      if (!useKv()) {
        return res.status(500).json({ ok: false, error: 'Chunked upload needs Redis storage.' });
      }
      const me = getSessionUser(req);
      const uploadId = String((req.body && req.body.upload_id) || '');
      const index = Number((req.body && req.body.index) || -1);
      if (!uploadId || index < 0 || !req.file) {
        return res.status(400).json({ ok: false, error: 'Invalid chunk.' });
      }
      const meta = await loadUploadMeta(uploadId);
      if (!meta || Number(meta.userId) !== Number(me.id)) {
        return res.status(404).json({ ok: false, error: 'Upload session not found.' });
      }
      if (index >= Number(meta.chunks)) {
        return res.status(400).json({ ok: false, error: 'Chunk index out of range.' });
      }
      const buf = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
      if (!buf) return res.status(400).json({ ok: false, error: 'Empty chunk.' });
      if (buf.length > CLIENT_CHUNK_BYTES + 64 * 1024) {
        return res.status(400).json({ ok: false, error: 'Chunk too large.' });
      }
      // Write straight into the final file key so complete() does not re-copy gigabytes.
      // Receipt keys are per-chunk so parallel uploads cannot overwrite each other.
      const { saveFileChunkAt, markUploadChunkReceived } = require('../kvStore');
      await saveFileChunkAt(meta.storedName, index, buf);
      await markUploadChunkReceived(uploadId, index);
      if (req.file.path) fs.unlink(req.file.path, () => {});
      return res.json({ ok: true, index });
    } catch (e) {
      console.error('upload/chunk', e);
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ ok: false, error: 'Chunk upload failed.' });
    }
  });
});

router.post('/upload/complete', requireAuth, async (req, res) => {
  try {
    if (!useKv()) {
      return res.status(500).json({ ok: false, error: 'Chunked upload needs Redis storage.' });
    }
    const me = getSessionUser(req);
    const uploadId = String((req.body && req.body.upload_id) || '');
    if (!uploadId) return res.status(400).json({ ok: false, error: 'upload_id required' });

    const meta = await loadUploadMeta(uploadId);
    if (!meta || Number(meta.userId) !== Number(me.id)) {
      return res.status(404).json({ ok: false, error: 'Upload session not found.' });
    }

    const { finalizeChunkedFile, deleteUploadSession: clearUpload, missingFileChunks } = require('../kvStore');
    const missing = await missingFileChunks(meta.storedName, Number(meta.chunks));
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Upload incomplete — missing ${missing.length} part(s). Please try again.`,
        missing_count: missing.length,
      });
    }

    // Chunks were written to the final keys during upload; just seal the file meta.
    const filename = await finalizeChunkedFile(
      meta.storedName,
      Number(meta.chunks),
      meta.mime || 'application/octet-stream',
      Number(meta.size),
    );
    await clearUpload(uploadId, Number(meta.chunks));

    const inserted = await query(
      `INSERT INTO items
       (admin_id, title, description, filename, original_name, mime_type, file_size, require_password, is_active)
       VALUES (:adminId, :title, :description, :filename, :originalName, :mime, :size, :requirePassword, 1)`,
      {
        adminId: me.id,
        title: meta.title,
        description: meta.description,
        filename,
        originalName: meta.originalName,
        mime: meta.mime || 'application/octet-stream',
        size: meta.size,
        requirePassword: meta.requirePassword ? 1 : 0,
      },
    );
    const insertId = Number((inserted && inserted.insertId) || 0);

    return res.json({
      ok: true,
      message: 'File uploaded.',
      item: {
        id: insertId,
        title: meta.title,
        description: meta.description,
        filename,
        original_name: meta.originalName,
        mime_type: meta.mime || 'application/octet-stream',
        file_size: meta.size,
        require_password: !!meta.requirePassword,
        is_active: true,
        uploader: me.username,
        unlocked_count: 0,
      },
    });
  } catch (err) {
    console.error('upload/complete', err);
    return res.status(500).json({ ok: false, error: 'Could not finish upload.' });
  }
});

router.post('/upload/s3/init', requireAuth, async (req, res) => {
  try {
    if (!useS3()) {
      return res.status(400).json({ ok: false, error: 'Object storage (R2/S3) is not configured.' });
    }
    const me = getSessionUser(req);
    const title = String((req.body && req.body.title) || '').trim();
    const description = String((req.body && req.body.description) || '').trim() || null;
    const requirePasswordRaw = req.body && req.body.require_password;
    const requirePassword = requirePasswordRaw === '1' || requirePasswordRaw === true || requirePasswordRaw === 'true' || requirePasswordRaw === 'on';
    const originalName = String((req.body && req.body.original_name) || 'file').slice(0, 180);
    const mime = String((req.body && req.body.mime_type) || 'application/octet-stream').slice(0, 120);
    const size = Number((req.body && req.body.size) || 0);
    const maxBytes = effectiveMaxUploadBytes();

    if (!title) return res.status(400).json({ ok: false, error: 'Title is required.' });
    if (!Number.isFinite(size) || size < 1) {
      return res.status(400).json({ ok: false, error: 'Choose a file to upload.' });
    }
    if (size > maxBytes) {
      return res.status(400).json({
        ok: false,
        error: `File is too large (max ${formatBytes(maxBytes)}).`,
      });
    }

    const storedName = randomFilename(originalName);
    const key = `uploads/${me.id}/${storedName}`;
    const multi = await createMultipartUpload({ key, contentType: mime });
    const parts = Math.ceil(size / multi.partSize);

    return res.json({
      ok: true,
      key: multi.key,
      upload_id: multi.uploadId,
      part_size: multi.partSize,
      parts,
      title,
      description,
      require_password: !!requirePassword,
      original_name: originalName,
      mime_type: mime,
      size,
    });
  } catch (err) {
    console.error('upload/s3/init', err);
    return res.status(500).json({ ok: false, error: 'Could not start cloud upload.' });
  }
});

router.post('/upload/s3/sign', requireAuth, async (req, res) => {
  try {
    if (!useS3()) {
      return res.status(400).json({ ok: false, error: 'Object storage (R2/S3) is not configured.' });
    }
    const key = String((req.body && req.body.key) || '');
    const uploadId = String((req.body && req.body.upload_id) || '');
    const partNumbers = Array.isArray(req.body && req.body.part_numbers)
      ? req.body.part_numbers.map(Number).filter((n) => n > 0)
      : [Number(req.body && req.body.part_number)].filter((n) => n > 0);

    if (!key || !uploadId || !partNumbers.length) {
      return res.status(400).json({ ok: false, error: 'Invalid sign request.' });
    }
    if (!key.includes(`uploads/${getSessionUser(req).id}/`)) {
      return res.status(403).json({ ok: false, error: 'Forbidden.' });
    }

    const urls = [];
    for (const partNumber of partNumbers.slice(0, 40)) {
      urls.push(await presignUploadPart({ key, uploadId, partNumber }));
    }
    return res.json({ ok: true, urls });
  } catch (err) {
    console.error('upload/s3/sign', err);
    return res.status(500).json({ ok: false, error: 'Could not sign upload part.' });
  }
});

router.post('/upload/s3/complete', requireAuth, async (req, res) => {
  try {
    if (!useS3()) {
      return res.status(400).json({ ok: false, error: 'Object storage (R2/S3) is not configured.' });
    }
    const me = getSessionUser(req);
    const key = String((req.body && req.body.key) || '');
    const uploadId = String((req.body && req.body.upload_id) || '');
    const parts = (req.body && req.body.parts) || [];
    const title = String((req.body && req.body.title) || '').trim();
    const description = String((req.body && req.body.description) || '').trim() || null;
    const requirePassword = !!(req.body && req.body.require_password);
    const originalName = String((req.body && req.body.original_name) || 'file').slice(0, 180);
    const mime = String((req.body && req.body.mime_type) || 'application/octet-stream').slice(0, 120);
    const size = Number((req.body && req.body.size) || 0);

    if (!key || !uploadId || !title || !parts.length) {
      return res.status(400).json({ ok: false, error: 'Invalid complete request.' });
    }
    if (!key.includes(`uploads/${me.id}/`)) {
      return res.status(403).json({ ok: false, error: 'Forbidden.' });
    }

    const filename = await completeMultipartUpload({ key, uploadId, parts });
    await query(
      `INSERT INTO items
       (admin_id, title, description, filename, original_name, mime_type, file_size, require_password, is_active)
       VALUES (:adminId, :title, :description, :filename, :originalName, :mime, :size, :requirePassword, 1)`,
      {
        adminId: me.id,
        title,
        description,
        filename,
        originalName,
        mime,
        size,
        requirePassword: requirePassword ? 1 : 0,
      },
    );
    return res.json({ ok: true, message: 'File uploaded.' });
  } catch (err) {
    console.error('upload/s3/complete', err);
    try {
      const key = String((req.body && req.body.key) || '');
      const uploadId = String((req.body && req.body.upload_id) || '');
      if (key && uploadId) await abortMultipartUpload({ key, uploadId });
    } catch (_) {}
    return res.status(500).json({ ok: false, error: 'Could not finish cloud upload.' });
  }
});

router.post('/items/:id/toggle-password', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const itemId = Number(req.params.id);
    const item = await findOwnedItem(itemId, me.id);
    if (!item) {
      return res.status(400).json({ ok: false, error: 'Could not update permission.' });
    }
    const next = Number(item.require_password) ? 0 : 1;
    await query('UPDATE items SET require_password = :v WHERE id = :id', { v: next, id: itemId });
    if (next) await revokeActiveItemAccess(itemId);
    return res.json({
      ok: true,
      message: next ? 'Password is now required.' : 'File is open — no password needed.',
      require_password: !!next,
    });
  } catch (err) {
    console.error('toggle-password', err);
    return res.status(500).json({ ok: false, error: 'Could not update permission.' });
  }
});

router.post('/items/:id/toggle', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const itemId = Number(req.params.id);
    const item = await findOwnedItem(itemId, me.id);
    if (!item) {
      return res.status(400).json({ ok: false, error: 'Could not update visibility.' });
    }
    const next = Number(item.is_active) === 0 ? 1 : 0;
    await query('UPDATE items SET is_active = :v WHERE id = :id', {
      v: next,
      id: itemId,
    });
    return res.json({
      ok: true,
      message: next ? 'File is visible again.' : 'File hidden from others.',
      is_active: !!next,
    });
  } catch (err) {
    console.error('toggle', err);
    return res.status(500).json({ ok: false, error: 'Could not update visibility.' });
  }
});

router.post('/items/:id/lock', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const itemId = Number(req.params.id);
    const item = await findOwnedItem(itemId, me.id);
    if (!item) {
      return res.status(400).json({ ok: false, error: 'Could not lock that file.' });
    }
    await revokeActiveItemAccess(itemId);
    return res.json({ ok: true, message: 'Access locked again for that file.' });
  } catch (err) {
    console.error('lock', err);
    return res.status(500).json({ ok: false, error: 'Could not lock that file.' });
  }
});

router.delete('/items/:id', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const itemId = Number(req.params.id);
    const item = await findOwnedItem(itemId, me.id);
    if (!item) {
      return res.status(400).json({ ok: false, error: 'Could not delete that file.' });
    }
    await query('DELETE FROM items WHERE id = :id', { id: itemId });
    await deleteFile(item.filename);
    return res.json({ ok: true, message: 'Item deleted.' });
  } catch (err) {
    console.error('delete item', err);
    return res.status(500).json({ ok: false, error: 'Could not delete that file.' });
  }
});

router.post('/account', requireAuth, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const body = req.body || {};
    const newUser = String(body.new_username || '').trim();
    const newPassword = String(body.new_password || '');
    const confirmPassword = String(body.confirm_password || '');
    const currentPassword = String(body.current_password || '');
    const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;

    if (!newUser || newUser.length < 3) {
      return res.status(400).json({ ok: false, error: 'Username must be at least 3 characters.' });
    }

    // Prefer an explicit hash column so Redis/JSON DB never strips it.
    const rows = await query(
      'SELECT id, username, password_hash, avatar FROM admins WHERE id = :id LIMIT 1',
      { id: me.id },
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ ok: false, error: 'Not logged in.' });

    if (changingPassword) {
      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        return res.status(400).json({
          ok: false,
          error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
        });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ ok: false, error: 'New password and confirm do not match.' });
      }
      if (!currentPassword) {
        return res.status(400).json({
          ok: false,
          code: 'BAD_CURRENT_PASSWORD',
          error: 'Enter your current sign-in password to set a new one.',
        });
      }
      if (!user.password_hash) {
        return res.status(500).json({
          ok: false,
          error: 'This account has no saved password hash. Sign out and register again, or ask an admin to reset it.',
        });
      }
      const hashStr = String(user.password_hash);
      if (/^\$2[aby]\$\d{2}\$/.test(hashStr)) {
        let ok = false;
        try {
          ok = await bcrypt.compare(currentPassword, hashStr);
        } catch (cmpErr) {
          console.error('account bcrypt.compare', cmpErr);
          ok = false;
        }
        if (!ok) {
          return res.status(400).json({
            ok: false,
            code: 'BAD_CURRENT_PASSWORD',
            error: 'Current password is incorrect. Use the same password you type on the Sign in page.',
          });
        }
      }
    }

    const [normalized, userError] = parseUsername(newUser);
    if (userError) return res.status(400).json({ ok: false, error: userError });
    if (await usernameTaken(normalized, me.id)) {
      return res.status(400).json({ ok: false, error: usernameTakenMessage() });
    }

    if (changingPassword) {
      const hash = await bcrypt.hash(newPassword, 10);
      await query(
        'UPDATE admins SET username = :username, password_hash = :hash WHERE id = :id',
        { username: normalized, hash, id: me.id },
      );
      setSessionUser(req, res, { id: me.id, username: normalized, avatar: user.avatar });
      return res.json({
        ok: true,
        message: 'Password updated. Use the new password next time you sign in.',
        username: normalized,
      });
    }

    if (normalized === user.username) {
      return res.json({ ok: true, message: 'Nothing to change.', username: normalized });
    }
    await query('UPDATE admins SET username = :username WHERE id = :id', {
      username: normalized,
      id: me.id,
    });
    setSessionUser(req, res, { id: me.id, username: normalized, avatar: user.avatar });
    return res.json({ ok: true, message: 'Username updated.', username: normalized });
  } catch (err) {
    console.error('account', err);
    return res.status(500).json({ ok: false, error: 'Could not update account.' });
  }
});

router.post('/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Choose a profile image.' });
    }
    try {
      const me = getSessionUser(req);
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Choose a profile image.' });
      }
      const storedName = req.file.filename || randomFilename(req.file.originalname);
      let avatar = storedName;
      if (useRemoteStorage) {
        const source = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
        if (!source) {
          return res.status(400).json({ ok: false, error: 'Choose a profile image.' });
        }
        const saved = await saveFile(source, {
          filename: storedName,
          contentType: req.file.mimetype || 'image/png',
          folder: 'avatars',
        });
        avatar = saved.filename;
        if (req.file.path) fs.unlink(req.file.path, () => {});
      }
      const rows = await query('SELECT avatar FROM admins WHERE id = :id LIMIT 1', { id: me.id });
      const old = rows[0] && rows[0].avatar;
      await query('UPDATE admins SET avatar = :avatar WHERE id = :id', {
        avatar,
        id: me.id,
      });
      setSessionUser(req, res, { id: me.id, username: me.username, avatar });
      if (old) await deleteFile(/^https?:\/\//i.test(old) || String(old).startsWith('kv://') ? old : path.join('avatars', old));
      return res.json({ ok: true, message: 'Profile image updated.', avatar });
    } catch (e) {
      console.error('avatar upload', e);
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ ok: false, error: 'Could not update avatar.' });
    }
  });
});

async function requireSiteOwner(req, res, next) {
  try {
    const me = getSessionUser(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const rows = await query('SELECT id FROM admins ORDER BY id ASC LIMIT 1');
    if (!rows[0] || Number(rows[0].id) !== Number(me.id)) {
      return res.status(403).json({ ok: false, error: 'Only the site owner can manage users.' });
    }
    return next();
  } catch (err) {
    console.error('requireSiteOwner', err);
    return res.status(500).json({ ok: false, error: 'Could not verify owner.' });
  }
}

router.get('/admin/users', requireAuth, requireSiteOwner, async (req, res) => {
  try {
    const users = await query(
      `SELECT a.id, a.username, a.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.admin_id = a.id) AS upload_count
       FROM admins a
       ORDER BY a.created_at ASC, a.id ASC`,
    );
    return res.json({
      ok: true,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        created_at: u.created_at,
        upload_count: Number(u.upload_count || 0),
      })),
    });
  } catch (err) {
    console.error('admin users', err);
    return res.status(500).json({ ok: false, error: 'Could not list users' });
  }
});

router.post('/admin/users', requireAuth, requireSiteOwner, async (req, res) => {
  try {
    const { username, password, confirm } = req.body || {};
    const [normalized, userError] = parseUsername(username);
    if (userError) return res.status(400).json({ ok: false, error: userError });
    if (String(password || '').length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      });
    }
    if (password !== confirm) {
      return res.status(400).json({ ok: false, error: 'Passwords do not match.' });
    }
    if (await usernameTaken(normalized)) {
      return res.status(400).json({ ok: false, error: usernameTakenMessage() });
    }
    const hash = await bcrypt.hash(String(password), 10);
    await query('INSERT INTO admins (username, password_hash) VALUES (:username, :hash)', {
      username: normalized,
      hash,
    });
    return res.json({ ok: true, message: 'User created. They can log in and upload files.' });
  } catch (err) {
    console.error('admin add user', err);
    return res.status(500).json({ ok: false, error: 'Could not create user.' });
  }
});

router.delete('/admin/users/:id', requireAuth, requireSiteOwner, async (req, res) => {
  try {
    const me = getSessionUser(req);
    const userId = Number(req.params.id);
    if (userId === me.id) {
      return res.status(400).json({ ok: false, error: 'You cannot delete your own account here.' });
    }
    const countRows = await query('SELECT COUNT(*) AS c FROM admins');
    if (Number(countRows[0].c) <= 1) {
      return res.status(400).json({ ok: false, error: 'Cannot delete the last user.' });
    }
    const rows = await query('SELECT id, avatar FROM admins WHERE id = :id LIMIT 1', { id: userId });
    const user = rows[0];
    if (!user) return res.status(400).json({ ok: false, error: 'User not found.' });

    const items = await query('SELECT id, filename FROM items WHERE admin_id = :id', { id: userId });
    await query('DELETE FROM admins WHERE id = :id', { id: userId });
    for (const item of items) {
      await deleteFile(item.filename);
    }
    if (user.avatar) {
      await deleteFile(/^https?:\/\//i.test(user.avatar) ? user.avatar : path.join('avatars', user.avatar));
    }
    return res.json({ ok: true, message: 'User deleted.' });
  } catch (err) {
    console.error('admin delete user', err);
    return res.status(500).json({ ok: false, error: 'Could not delete user.' });
  }
});

module.exports = router;
