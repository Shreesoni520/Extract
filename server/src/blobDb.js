const { put, list } = require('@vercel/blob');
const { useKv, loadJsonDb, saveJsonDb } = require('./kvStore');

const DB_PATH = 'data/db.json';
const READ_CACHE_MS = 800;

function emptyDb() {
  return {
    admins: [],
    items: [],
    access_requests: [],
    notifications: [],
    chat_messages: [],
    nextId: { admins: 1, items: 1, access_requests: 1, notifications: 1, chat_messages: 1 },
    revision: 1,
  };
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function secondsLeft(sqlDatetime) {
  if (!sqlDatetime) return 0;
  const t = Date.parse(String(sqlDatetime).replace(' ', 'T'));
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

function normalizeDb(data) {
  const base = emptyDb();
  if (!data || typeof data !== 'object') return base;
  return {
    admins: Array.isArray(data.admins) ? data.admins : [],
    items: Array.isArray(data.items) ? data.items : [],
    access_requests: Array.isArray(data.access_requests) ? data.access_requests : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
    chat_messages: Array.isArray(data.chat_messages) ? data.chat_messages : [],
    nextId: {
      admins: Math.max(1, Number(data.nextId?.admins) || 1),
      items: Math.max(1, Number(data.nextId?.items) || 1),
      access_requests: Math.max(1, Number(data.nextId?.access_requests) || 1),
      notifications: Math.max(1, Number(data.nextId?.notifications) || 1),
      chat_messages: Math.max(1, Number(data.nextId?.chat_messages) || 1),
    },
    revision: Math.max(1, Number(data.revision) || 1),
  };
}

function bumpNextIds(db) {
  const maxId = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  db.nextId.admins = Math.max(db.nextId.admins, maxId(db.admins) + 1);
  db.nextId.items = Math.max(db.nextId.items, maxId(db.items) + 1);
  db.nextId.access_requests = Math.max(db.nextId.access_requests, maxId(db.access_requests) + 1);
  db.nextId.chat_messages = Math.max(db.nextId.chat_messages || 1, maxId(db.chat_messages || []) + 1);
  db.nextId.notifications = Math.max(db.nextId.notifications, maxId(db.notifications) + 1);
}

/** Merge concurrent edits so a stale writer cannot wipe newer rows. */
function mergeDb(base, draft, newest) {
  const tables = ['admins', 'items', 'access_requests', 'notifications', 'chat_messages'];
  const out = normalizeDb(newest);

  tables.forEach((table) => {
    const baseMap = new Map((base[table] || []).map((r) => [Number(r.id), r]));
    const draftMap = new Map((draft[table] || []).map((r) => [Number(r.id), r]));
    const newestMap = new Map((out[table] || []).map((r) => [Number(r.id), r]));

    const removedIds = [...baseMap.keys()].filter((id) => !draftMap.has(id));
    // Guard only against accidental full-table wipes of substantial data.
    // Clearing the last "used" request must be allowed (draftMap can become empty).
    const suspiciousWipe = baseMap.size >= 8
      && draftMap.size === 0
      && removedIds.length === baseMap.size;
    const massDelete = removedIds.length >= 8
      && draftMap.size < Math.ceil(baseMap.size * 0.35);

    if (!suspiciousWipe && !massDelete) {
      for (const id of removedIds) newestMap.delete(id);
    }

    // Upserts / inserts we made
    for (const [id, row] of draftMap.entries()) {
      const before = baseMap.get(id);
      if (!before || JSON.stringify(before) !== JSON.stringify(row)) {
        newestMap.set(id, row);
      } else if (!newestMap.has(id)) {
        newestMap.set(id, row);
      }
    }

    out[table] = Array.from(newestMap.values()).sort((a, b) => Number(a.id) - Number(b.id));
  });

  out.nextId = {
    admins: Math.max(base.nextId.admins, draft.nextId.admins, newest.nextId.admins, out.nextId.admins),
    items: Math.max(base.nextId.items, draft.nextId.items, newest.nextId.items, out.nextId.items),
    access_requests: Math.max(
      base.nextId.access_requests,
      draft.nextId.access_requests,
      newest.nextId.access_requests,
      out.nextId.access_requests,
    ),
    notifications: Math.max(
      base.nextId.notifications,
      draft.nextId.notifications,
      newest.nextId.notifications,
      out.nextId.notifications,
    ),
    chat_messages: Math.max(
      base.nextId.chat_messages || 1,
      draft.nextId.chat_messages || 1,
      newest.nextId.chat_messages || 1,
      out.nextId.chat_messages || 1,
    ),
  };
  bumpNextIds(out);
  out.revision = Math.max(Number(newest.revision) || 1, Number(draft.revision) || 1) + 1;
  return out;
}

function isEffectivelyEmpty(db) {
  return !db.admins.length && !db.items.length && !db.access_requests.length
    && !db.notifications.length && !(db.chat_messages && db.chat_messages.length);
}

async function findDbBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN missing');
  const listed = await list({ prefix: 'data/', token, limit: 50 });
  const blobs = (listed.blobs || []).filter((b) => (
    b.pathname === DB_PATH
    || b.pathname.endsWith('/db.json')
    || b.pathname === 'db.json'
  ));
  if (!blobs.length) return null;
  blobs.sort((a, b) => {
    const ta = Date.parse(a.uploadedAt || a.uploaded_at || 0) || 0;
    const tb = Date.parse(b.uploadedAt || b.uploaded_at || 0) || 0;
    return tb - ta;
  });
  // Prefer exact path, else newest matching db.json
  return blobs.find((b) => b.pathname === DB_PATH) || blobs[0];
}

async function fetchDbFresh() {
  // Prefer Upstash Redis (Blob store is suspended on this account).
  if (useKv()) {
    try {
      const raw = await loadJsonDb();
      if (raw) {
        const data = normalizeDb(raw);
        bumpNextIds(data);
        globalThis.__SE_BLOB_DB = data;
        globalThis.__SE_BLOB_DB_AT = Date.now();
        return data;
      }
      const fresh = emptyDb();
      globalThis.__SE_BLOB_DB = fresh;
      globalThis.__SE_BLOB_DB_AT = Date.now();
      return cloneDb(fresh);
    } catch (err) {
      console.warn('kvDb fetch:', err.message);
      if (globalThis.__SE_BLOB_DB && !isEffectivelyEmpty(globalThis.__SE_BLOB_DB)) {
        return cloneDb(globalThis.__SE_BLOB_DB);
      }
      throw err;
    }
  }

  try {
    const hit = await findDbBlob();
    if (hit?.url) {
      const res = await fetch(hit.url, { cache: 'no-store' });
      if (res.ok) {
        const data = normalizeDb(await res.json());
        bumpNextIds(data);
        globalThis.__SE_BLOB_DB = data;
        globalThis.__SE_BLOB_DB_AT = Date.now();
        return data;
      }
    }
  } catch (err) {
    console.warn('blobDb fetch:', err.message);
    if (globalThis.__SE_BLOB_DB && !isEffectivelyEmpty(globalThis.__SE_BLOB_DB)) {
      return cloneDb(globalThis.__SE_BLOB_DB);
    }
    throw err;
  }

  if (globalThis.__SE_BLOB_DB && !isEffectivelyEmpty(globalThis.__SE_BLOB_DB)) {
    return cloneDb(globalThis.__SE_BLOB_DB);
  }

  const fresh = emptyDb();
  globalThis.__SE_BLOB_DB = fresh;
  globalThis.__SE_BLOB_DB_AT = Date.now();
  return cloneDb(fresh);
}

async function loadDb(opts = {}) {
  const allowCache = opts.allowCache !== false;
  const cached = globalThis.__SE_BLOB_DB;
  const at = globalThis.__SE_BLOB_DB_AT || 0;
  if (allowCache && cached && Date.now() - at < READ_CACHE_MS) {
    return cloneDb(cached);
  }
  return fetchDbFresh();
}

async function saveDb(db) {
  const normalized = normalizeDb(db);
  bumpNextIds(normalized);

  // Never overwrite a populated remote DB with an empty local snapshot.
  if (isEffectivelyEmpty(normalized)) {
    try {
      const remote = await fetchDbFresh();
      if (!isEffectivelyEmpty(remote)) {
        console.warn('blobDb refused to save empty DB over populated remote');
        globalThis.__SE_BLOB_DB = remote;
        globalThis.__SE_BLOB_DB_AT = Date.now();
        return remote;
      }
    } catch (_) {}
  }

  if (useKv()) {
    await saveJsonDb(normalized);
    globalThis.__SE_BLOB_DB = normalized;
    globalThis.__SE_BLOB_DB_AT = Date.now();
    return normalized;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  await put(DB_PATH, JSON.stringify(normalized), {
    access: 'public',
    contentType: 'application/json',
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  globalThis.__SE_BLOB_DB = normalized;
  globalThis.__SE_BLOB_DB_AT = Date.now();
  return normalized;
}

function enqueueWrite(task) {
  const prev = globalThis.__SE_BLOB_WRITE_CHAIN || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  globalThis.__SE_BLOB_WRITE_CHAIN = next.catch(() => {});
  return next;
}

async function mutateDb(mutator) {
  return enqueueWrite(async () => {
    let lastErr;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const base = await fetchDbFresh();
        const draft = cloneDb(base);
        const result = await mutator(draft);
        bumpNextIds(draft);

        // Skip Blob write when nothing changed (stops expire/poll thrash).
        if (JSON.stringify(base) === JSON.stringify(draft)) {
          globalThis.__SE_BLOB_DB = base;
          globalThis.__SE_BLOB_DB_AT = Date.now();
          return result;
        }

        draft.revision = (Number(draft.revision) || 1) + 1;

        const newest = await fetchDbFresh();
        const merged = mergeDb(base, draft, newest);
        await saveDb(merged);
        return result;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 40 + attempt * 60));
      }
    }
    throw lastErr || new Error('blobDb mutate failed');
  });
}

function norm(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWriteSql(n) {
  return /^(insert|update|delete)\b/.test(n);
}

async function query(sql, params = {}) {
  const n = norm(sql);
  const p = params || {};

  if (!isWriteSql(n)) {
    const db = await loadDb({ allowCache: true });
    return runRead(db, n, p, sql);
  }

  return mutateDb(async (db) => runWrite(db, n, p, sql));
}

function runRead(db, n, p, sql) {
  if (n.includes('from chat_messages') && n.includes('access_request_id')) {
    const rid = Number(p.requestId || p.access_request_id || p.id);
    return (db.chat_messages || [])
      .filter((m) => Number(m.access_request_id) === rid)
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((m) => {
        const sender = db.admins.find((a) => Number(a.id) === Number(m.sender_id));
        return {
          id: m.id,
          access_request_id: m.access_request_id,
          sender_id: m.sender_id,
          body: m.body,
          created_at: m.created_at,
          sender_username: sender ? sender.username : null,
        };
      });
  }
  if (n === 'select id, username from admins') {
    return db.admins.map((a) => ({ id: a.id, username: a.username }));
  }
  if (n.startsWith('select id, username, password_hash, avatar from admins where username')) {
    const u = String(p.u || '').toLowerCase();
    return db.admins.filter((a) => a.username === u).slice(0, 1);
  }
  if (n.startsWith('select id, username, password_hash, avatar from admins where id')) {
    return db.admins.filter((a) => Number(a.id) === Number(p.id)).map((a) => ({
      id: a.id,
      username: a.username,
      password_hash: a.password_hash,
      avatar: a.avatar || null,
    })).slice(0, 1);
  }
  if (n.startsWith('select id, username, avatar from admins where id')
    || n.startsWith('select id, username from admins where id')) {
    return db.admins.filter((a) => Number(a.id) === Number(p.id)).map((a) => ({
      id: a.id, username: a.username, avatar: a.avatar || null,
    })).slice(0, 1);
  }
  if (n.startsWith('select * from admins where id') || n.startsWith('select id, avatar from admins where id')) {
    return db.admins.filter((a) => Number(a.id) === Number(p.id)).slice(0, 1);
  }
  if (n.startsWith('select avatar from admins where id')) {
    return db.admins.filter((a) => Number(a.id) === Number(p.id)).map((a) => ({ avatar: a.avatar || null })).slice(0, 1);
  }
  if (n.startsWith('select username, avatar from admins where id')) {
    return db.admins.filter((a) => Number(a.id) === Number(p.id)).map((a) => ({
      username: a.username, avatar: a.avatar || null,
    })).slice(0, 1);
  }
  if (n.startsWith('select count(*) as c from admins')) {
    return [{ c: db.admins.length }];
  }
  if (n.includes('select a.id, a.username, a.created_at') && n.includes('from admins a')) {
    return db.admins.map((a) => ({
      id: a.id,
      username: a.username,
      created_at: a.created_at,
      upload_count: db.items.filter((i) => Number(i.admin_id) === Number(a.id)).length,
    }));
  }

  if (n.startsWith('select * from items where id')) {
    return db.items.filter((i) => Number(i.id) === Number(p.id)).slice(0, 1);
  }
  if (n.includes('from items') && n.includes('admin_id = :userid') && n.includes('is_active = 1')) {
    return db.items
      .filter((i) => Number(i.admin_id) === Number(p.userId) && Number(i.is_active) !== 0)
      .sort((a, b) => Number(b.id) - Number(a.id));
  }
  if (n.includes('filename from items where admin_id')) {
    return db.items.filter((i) => Number(i.admin_id) === Number(p.id)).map((i) => ({ id: i.id, filename: i.filename }));
  }
  if (n.includes('unlocked_count') || (n.includes('from items i') && n.includes('admin_id = :adminid'))) {
    const ownerId = Number(p.adminId || p.meId || p.id || 0);
    return db.items
      .filter((i) => Number(i.admin_id) === ownerId)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((i) => ({
        ...i,
        unlocked_count: db.access_requests.filter((r) => Number(r.item_id) === Number(i.id) && r.status === 'unlocked').length,
      }));
  }
  if (n.startsWith('select id, filename from items where admin_id')) {
    return db.items.filter((i) => Number(i.admin_id) === Number(p.id)).map((i) => ({ id: i.id, filename: i.filename }));
  }
  if (n.includes('select') && n.includes('from items') && n.includes('admin_id = :userid')) {
    return db.items
      .filter((i) => Number(i.admin_id) === Number(p.userId) && (n.includes('is_active = 1') ? Number(i.is_active) !== 0 : true))
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  if (n.includes('select id from access_requests') && n.includes('item_id') && n.includes('pending')) {
    return db.access_requests
      .filter((r) => Number(r.item_id) === Number(p.itemId) && ['pending', 'unlocked'].includes(r.status))
      .map((r) => ({ id: r.id }));
  }
  // Chat / revoke join: SELECT ar..., i.admin_id, i.title AS item_title ...
  if (n.includes('from access_requests ar') && n.includes('join items') && n.includes('ar.id = :id')) {
    const ar = db.access_requests.find((r) => Number(r.id) === Number(p.id));
    if (!ar) return [];
    const item = db.items.find((i) => Number(i.id) === Number(ar.item_id));
    if (!item) return [];
    return [{
      ...ar,
      admin_id: item.admin_id,
      item_pk: item.id,
      item_title: item.title,
    }];
  }
  // Personal access: by logged-in requester_id
  if (n.includes('from access_requests') && n.includes('requester_id') && n.includes('item_id')) {
    const wantPendingOnly = n.includes("status = 'pending'") && !n.includes("'unlocked'");
    return db.access_requests
      .filter((r) => {
        if (Number(r.item_id) !== Number(p.itemId)) return false;
        if (Number(r.requester_id) !== Number(p.viewerId || p.requesterId || p.meId)) return false;
        if (wantPendingOnly) return r.status === 'pending';
        return ['pending', 'unlocked'].includes(r.status);
      })
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 1);
  }
  if (n.includes('from access_requests') && n.includes('visitor_token') && n.includes('item_id')) {
    const wantPendingOnly = n.includes("status = 'pending'") && !n.includes("'unlocked'");
    return db.access_requests
      .filter((r) => {
        if (Number(r.item_id) !== Number(p.itemId)) return false;
        if (r.visitor_token !== p.token) return false;
        if (wantPendingOnly) return r.status === 'pending';
        return ['pending', 'unlocked'].includes(r.status);
      })
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 1);
  }
  if (n.startsWith('select * from access_requests where id') || (n.includes('from access_requests') && n.includes('where id = :id') && !n.includes('join'))) {
    return db.access_requests.filter((r) => Number(r.id) === Number(p.id)).slice(0, 1);
  }
  if (n.includes('from access_requests') && n.includes("status = 'pending'")) {
    return db.access_requests
      .filter((r) => Number(r.item_id) === Number(p.itemId || p.item_id)
        && (!p.token || r.visitor_token === p.token)
        && r.status === 'pending')
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 1);
  }

  if (n.includes('count(*) as c') && n.includes('from notifications') && n.includes('is_read = 0')) {
    const ownerId = Number(p.ownerId);
    const c = db.notifications.filter((nRow) => {
      if (nRow.is_read) return false;
      const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
      if (!ar || !['pending', 'unlocked'].includes(ar.status)) return false;
      const item = db.items.find((i) => Number(i.id) === Number(ar.item_id));
      return item && Number(item.admin_id) === ownerId;
    }).length;
    return [{ c }];
  }
  if (n.includes('count(*) as c') && n.includes('from notifications') && n.includes("status in ('used', 'expired')")) {
    const ownerId = Number(p.ownerId);
    const c = db.notifications.filter((nRow) => {
      const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
      if (!ar || !['used', 'expired'].includes(ar.status)) return false;
      const item = db.items.find((i) => Number(i.id) === Number(ar.item_id));
      return item && Number(item.admin_id) === ownerId;
    }).length;
    return [{ c }];
  }
  // Single clear-done lookup: SELECT n.id, ar.id AS ar_id, ar.status, i.admin_id ...
  if (
    n.includes('from notifications n')
    && n.includes('join access_requests')
    && n.includes('n.id = :id')
    && (n.includes('ar_id') || n.includes('admin_id'))
  ) {
    const nRow = db.notifications.find((x) => Number(x.id) === Number(p.id));
    if (!nRow) return [];
    const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
    const item = ar && db.items.find((i) => Number(i.id) === Number(ar.item_id));
    if (!ar || !item) return [];
    if (p.ownerId != null && Number(item.admin_id) !== Number(p.ownerId)) return [];
    return [{
      id: nRow.id,
      ar_id: ar.id,
      status: ar.status,
      admin_id: item.admin_id,
    }];
  }
  if (n.includes('from notifications n') && n.includes('join access_requests')) {
    const ownerId = Number(p.ownerId);
    const sinceId = Number(p.sinceId || 0);
    return db.notifications
      .map((nRow) => {
        const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
        const item = ar && db.items.find((i) => Number(i.id) === Number(ar.item_id));
        if (!ar || !item || Number(item.admin_id) !== ownerId) return null;
        if (sinceId && Number(nRow.id) <= sinceId) return null;
        const requester = ar.requester_id
          ? db.admins.find((a) => Number(a.id) === Number(ar.requester_id))
          : null;
        return {
          n_id: nRow.id,
          message: nRow.message,
          is_read: nRow.is_read,
          n_created: nRow.created_at,
          request_id: ar.id,
          password_plain: ar.password_plain,
          status: ar.status,
          password_expires_at: ar.password_expires_at,
          unlock_expires_at: ar.unlock_expires_at,
          item_title: item.title,
          item_id: item.id,
          requester_id: ar.requester_id,
          requester_username: requester ? requester.username : null,
          requester_avatar: requester ? requester.avatar : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const rank = (s) => (s === 'pending' ? 0 : s === 'unlocked' ? 1 : 2);
        return rank(a.status) - rank(b.status) || Number(b.n_id) - Number(a.n_id);
      })
      .slice(0, 40);
  }

  if (n.includes('from admins') && (n.includes('like') || p.q != null || p.like != null)) {
    const rawQ = String(p.q || p.like || '')
      .toLowerCase()
      .replace(/^%+|%+$/g, '')
      .trim();
    const meId = Number(p.meId || p.me || 0);
    return db.admins
      .filter((a) => {
        if (Number(a.id) === meId) return false;
        if (!rawQ) return false;
        return String(a.username || '').toLowerCase().includes(rawQ);
      })
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
      .slice(0, 40)
      .map((a) => ({
        id: a.id,
        username: a.username,
        avatar: a.avatar,
        created_at: a.created_at,
        file_count: db.items.filter((i) => Number(i.admin_id) === Number(a.id) && Number(i.is_active) !== 0).length,
      }));
  }

  console.error('blobDb unsupported read SQL:', sql, params);
  throw new Error('Unsupported SQL in blobDb');
}

function runWrite(db, n, p, sql) {
  if (n.startsWith('insert into admins')) {
    const uname = String(p.username || '').toLowerCase().trim();
    const taken = db.admins.some((a) => String(a.username || '').toLowerCase().trim() === uname);
    if (taken) {
      const err = new Error('USERNAME_TAKEN');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    const id = db.nextId.admins++;
    db.admins.push({
      id,
      username: uname,
      password_hash: p.hash || p.password_hash,
      avatar: null,
      created_at: nowSql(),
    });
    return { insertId: id, affectedRows: 1 };
  }
  if (n.startsWith('update admins set username = :username, password_hash')) {
    const a = db.admins.find((x) => Number(x.id) === Number(p.id));
    if (a) {
      a.username = p.username;
      a.password_hash = p.hash || p.password_hash;
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }
  if (n.startsWith('update admins set username = :username where id')) {
    const a = db.admins.find((x) => Number(x.id) === Number(p.id));
    if (a) { a.username = p.username; return { affectedRows: 1 }; }
    return { affectedRows: 0 };
  }
  if (n.startsWith('update admins set avatar')) {
    const a = db.admins.find((x) => Number(x.id) === Number(p.id));
    if (a) { a.avatar = p.avatar; return { affectedRows: 1 }; }
    return { affectedRows: 0 };
  }
  if (n.startsWith('delete from admins where id')) {
    const before = db.admins.length;
    db.admins = db.admins.filter((a) => Number(a.id) !== Number(p.id));
    db.items = db.items.filter((i) => Number(i.admin_id) !== Number(p.id));
    return { affectedRows: before - db.admins.length };
  }

  if (n.startsWith('insert into items')) {
    const id = db.nextId.items++;
    db.items.unshift({
      id,
      admin_id: Number(p.adminId),
      title: p.title,
      description: p.description,
      filename: p.filename,
      original_name: p.originalName,
      mime_type: p.mime,
      file_size: Number(p.size || 0),
      require_password: Number(p.requirePassword ? 1 : 0),
      is_active: 1,
      created_at: nowSql(),
    });
    return { insertId: id, affectedRows: 1 };
  }
  if (n.startsWith('update items set require_password')) {
    const item = db.items.find((i) => Number(i.id) === Number(p.id));
    if (item) { item.require_password = Number(p.v); return { affectedRows: 1 }; }
    return { affectedRows: 0 };
  }
  if (n.startsWith('update items set is_active')) {
    const item = db.items.find((i) => Number(i.id) === Number(p.id));
    if (item) { item.is_active = Number(p.v); return { affectedRows: 1 }; }
    return { affectedRows: 0 };
  }
  if (n.startsWith('delete from items where id')) {
    const itemId = Number(p.id);
    const before = db.items.length;
    const arIds = new Set(
      db.access_requests.filter((r) => Number(r.item_id) === itemId).map((r) => Number(r.id)),
    );
    db.items = db.items.filter((i) => Number(i.id) !== itemId);
    db.access_requests = db.access_requests.filter((r) => Number(r.item_id) !== itemId);
    db.notifications = db.notifications.filter((nRow) => !arIds.has(Number(nRow.access_request_id)));
    db.chat_messages = (db.chat_messages || []).filter((m) => !arIds.has(Number(m.access_request_id)));
    return { affectedRows: before - db.items.length };
  }

  if (n.startsWith('update access_requests set status = \'used\' where id')
    || n.startsWith('update access_requests set status = \'expired\' where id')) {
    const r = db.access_requests.find((x) => Number(x.id) === Number(p.id));
    if (r) {
      r.status = n.includes('expired') ? 'expired' : 'used';
      if (r.status === 'used') r.unlock_expires_at = nowSql();
      db.chat_messages = (db.chat_messages || []).filter((m) => Number(m.access_request_id) !== Number(r.id));
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }
  if (n.startsWith('update access_requests set status = \'used\', unlock_expires_at') && n.includes('item_id')) {
    let count = 0;
    const closed = [];
    db.access_requests.forEach((r) => {
      if (Number(r.item_id) === Number(p.itemId) && ['pending', 'unlocked'].includes(r.status)) {
        r.status = 'used';
        r.unlock_expires_at = nowSql();
        closed.push(Number(r.id));
        count += 1;
      }
    });
    if (closed.length) {
      const gone = new Set(closed);
      db.chat_messages = (db.chat_messages || []).filter((m) => !gone.has(Number(m.access_request_id)));
    }
    return { affectedRows: count };
  }
  if (n.includes('update access_requests') && n.includes('status = \'unlocked\'')) {
    const r = db.access_requests.find((x) => Number(x.id) === Number(p.id) || Number(x.id) === Number(p.requestId));
    if (r) {
      r.status = 'unlocked';
      r.unlocked_at = nowSql();
      r.unlock_expires_at = p.expires || p.unlockExpires || p.unlock_expires_at;
      if (p.viewerId != null || p.requesterId != null) {
        r.requester_id = Number(p.viewerId || p.requesterId);
      }
      if (p.token || p.visitor_token || p.visitorToken) {
        r.visitor_token = p.token || p.visitor_token || p.visitorToken;
      }
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }
  if (n.startsWith('insert into access_requests')) {
    const id = db.nextId.access_requests++;
    db.access_requests.push({
      id,
      item_id: Number(p.itemId || p.item_id),
      visitor_token: p.token || p.visitor_token || p.visitorToken,
      requester_id: p.requesterId || p.requester_id || null,
      password_plain: p.password || p.password_plain,
      status: 'pending',
      password_expires_at: p.expires || p.passwordExpires || p.password_expires_at,
      unlocked_at: null,
      unlock_expires_at: null,
      created_at: nowSql(),
    });
    return { insertId: id, affectedRows: 1 };
  }
  if (n.startsWith('delete from access_requests where id')) {
    const id = Number(p.id);
    const before = db.access_requests.length;
    db.access_requests = db.access_requests.filter((r) => Number(r.id) !== id);
    db.notifications = db.notifications.filter((nRow) => Number(nRow.access_request_id) !== id);
    db.chat_messages = (db.chat_messages || []).filter((m) => Number(m.access_request_id) !== id);
    return { affectedRows: before - db.access_requests.length };
  }
  // Clear done: DELETE FROM access_requests WHERE status IN ('used', 'expired')
  // Optional owner filter via JOIN items / :ownerId
  if (
    n.includes('delete from access_requests')
    && (n.includes("'used'") || n.includes('used'))
    && (n.includes("'expired'") || n.includes('expired'))
  ) {
    const ownerId = Number(p.ownerId || p.meId || 0);
    const before = db.access_requests.length;
    const removeIds = new Set();
    db.access_requests.forEach((r) => {
      if (r.status !== 'used' && r.status !== 'expired') return;
      if (ownerId > 0) {
        const item = db.items.find((i) => Number(i.id) === Number(r.item_id));
        if (!item || Number(item.admin_id) !== ownerId) return;
      }
      removeIds.add(Number(r.id));
    });
    db.access_requests = db.access_requests.filter((r) => !removeIds.has(Number(r.id)));
    db.notifications = db.notifications.filter((nRow) => !removeIds.has(Number(nRow.access_request_id)));
    db.chat_messages = (db.chat_messages || []).filter((m) => !removeIds.has(Number(m.access_request_id)));
    return { affectedRows: before - db.access_requests.length };
  }
  if (n.startsWith('delete from chat_messages where access_request_id =')) {
    const rid = Number(p.requestId || p.access_request_id || p.id);
    const before = (db.chat_messages || []).length;
    db.chat_messages = (db.chat_messages || []).filter((m) => Number(m.access_request_id) !== rid);
    return { affectedRows: before - db.chat_messages.length };
  }
  if (n.startsWith('insert into chat_messages')) {
    if (!db.nextId.chat_messages) db.nextId.chat_messages = 1;
    const id = db.nextId.chat_messages++;
    db.chat_messages = db.chat_messages || [];
    db.chat_messages.push({
      id,
      access_request_id: Number(p.requestId || p.access_request_id),
      sender_id: Number(p.senderId || p.sender_id),
      body: String(p.body || '').slice(0, 150),
      created_at: nowSql(),
    });
    return { insertId: id, affectedRows: 1 };
  }
  if (n.startsWith('update access_requests set status = \'expired\' where status = \'pending\'')) {
    let c = 0;
    db.access_requests.forEach((r) => {
      if (r.status === 'pending' && secondsLeft(r.password_expires_at) <= 0) {
        r.status = 'expired';
        c += 1;
      }
    });
    return { affectedRows: c };
  }
  if (n.startsWith('update access_requests set status = \'used\' where status = \'unlocked\'')) {
    let c = 0;
    db.access_requests.forEach((r) => {
      if (r.status === 'unlocked' && r.unlock_expires_at && secondsLeft(r.unlock_expires_at) <= 0) {
        r.status = 'used';
        c += 1;
      }
    });
    return { affectedRows: c };
  }

  if (n.startsWith('insert into notifications')) {
    const id = db.nextId.notifications++;
    db.notifications.unshift({
      id,
      access_request_id: Number(p.reqId || p.accessRequestId || p.access_request_id || p.requestId),
      message: p.message,
      is_read: 0,
      created_at: nowSql(),
    });
    return { insertId: id, affectedRows: 1 };
  }
  if (n.startsWith('update notifications set is_read = 1 where id')) {
    const note = db.notifications.find((x) => Number(x.id) === Number(p.id));
    if (note) { note.is_read = 1; return { affectedRows: 1 }; }
    return { affectedRows: 0 };
  }
  // Mark all read: UPDATE notifications n JOIN ... SET n.is_read = 1 WHERE i.admin_id = :ownerId
  if (
    n.includes('update notifications')
    && n.includes('is_read = 1')
    && (n.includes('admin_id') || n.includes(':ownerid'))
  ) {
    let c = 0;
    db.notifications.forEach((nRow) => {
      const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
      const item = ar && db.items.find((i) => Number(i.id) === Number(ar.item_id));
      if (item && Number(item.admin_id) === Number(p.ownerId || p.meId || p.id)) {
        if (!nRow.is_read) { nRow.is_read = 1; c += 1; }
      }
    });
    return { affectedRows: c };
  }
  if (
    n.startsWith('delete from notifications where id')
    || ((n.includes('delete from notifications') || (n.includes('clear') && n.includes('notifications')))
      && (p.notification_id || p.id))
  ) {
    if (p.notification_id || p.id) {
      const id = Number(p.notification_id || p.id);
      const before = db.notifications.length;
      db.notifications = db.notifications.filter((x) => Number(x.id) !== id);
      return { affectedRows: before - db.notifications.length };
    }
    const ownerId = Number(p.ownerId || p.meId || 0);
    const before = db.notifications.length;
    db.notifications = db.notifications.filter((nRow) => {
      const ar = db.access_requests.find((r) => Number(r.id) === Number(nRow.access_request_id));
      const item = ar && db.items.find((i) => Number(i.id) === Number(ar.item_id));
      if (!item || Number(item.admin_id) !== ownerId) return true;
      return !['used', 'expired'].includes(ar.status);
    });
    return { affectedRows: before - db.notifications.length };
  }

  console.error('blobDb unsupported write SQL:', sql, params);
  throw new Error('Unsupported SQL in blobDb');
}

async function expireStaleRequests() {
  const now = Date.now();
  // Avoid hammering Blob on every page poll / API hit.
  if (globalThis.__SE_EXPIRE_AT && now - globalThis.__SE_EXPIRE_AT < 20000) {
    return { affectedRows: 0 };
  }
  globalThis.__SE_EXPIRE_AT = now;
  // Batch both status cleanups in one mutate so we don't thrash Blob storage.
  return mutateDb((db) => {
    let c = 0;
    const closedIds = [];
    db.access_requests.forEach((r) => {
      if (r.status === 'pending' && secondsLeft(r.password_expires_at) <= 0) {
        r.status = 'expired';
        closedIds.push(Number(r.id));
        c += 1;
      } else if (r.status === 'unlocked' && r.unlock_expires_at && secondsLeft(r.unlock_expires_at) <= 0) {
        r.status = 'used';
        closedIds.push(Number(r.id));
        c += 1;
      }
    });
    if (closedIds.length) {
      const gone = new Set(closedIds);
      db.chat_messages = (db.chat_messages || []).filter((m) => !gone.has(Number(m.access_request_id)));
    }
    return { affectedRows: c };
  });
}

/** Clear finished access requests for an owner in one atomic write. */
async function clearDoneForOwner(ownerId, onlyRequestId = null) {
  const oid = Number(ownerId);
  const onlyId = onlyRequestId != null ? Number(onlyRequestId) : null;
  return mutateDb((db) => {
    const removeIds = new Set();
    db.access_requests.forEach((r) => {
      if (r.status !== 'used' && r.status !== 'expired') return;
      if (onlyId != null && Number(r.id) !== onlyId) return;
      const item = db.items.find((i) => Number(i.id) === Number(r.item_id));
      if (!item || Number(item.admin_id) !== oid) return;
      removeIds.add(Number(r.id));
    });
    if (!removeIds.size) return { affectedRows: 0, removedIds: [] };
    const before = db.access_requests.length;
    db.access_requests = db.access_requests.filter((r) => !removeIds.has(Number(r.id)));
    db.notifications = db.notifications.filter((nRow) => !removeIds.has(Number(nRow.access_request_id)));
    db.chat_messages = (db.chat_messages || []).filter((m) => !removeIds.has(Number(m.access_request_id)));
    return { affectedRows: before - db.access_requests.length, removedIds: [...removeIds] };
  });
}

/** Wipe chat threads for request ids (lock / end of session). */
async function purgeChatForRequests(requestIds) {
  const ids = (requestIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) return { affectedRows: 0 };
  const set = new Set(ids);
  return mutateDb((db) => {
    const before = (db.chat_messages || []).length;
    db.chat_messages = (db.chat_messages || []).filter((m) => !set.has(Number(m.access_request_id)));
    return { affectedRows: before - db.chat_messages.length };
  });
}

async function init() {
  await fetchDbFresh();
  return true;
}

module.exports = {
  query,
  expireStaleRequests,
  clearDoneForOwner,
  purgeChatForRequests,
  init,
  pool: null,
};
