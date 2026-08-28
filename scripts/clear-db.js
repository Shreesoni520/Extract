/**
 * Wipe app data so the site starts empty (users, files, requests, chats).
 * Clears Redis/KV (Vercel), local MySQL, and local upload files.
 * Keeps code and env config.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const { useKv, loadJsonDb, saveJsonDb, deleteFileChunks, DB_KEY } = require('../server/src/kvStore');

function emptyDb() {
  return {
    admins: [],
    items: [],
    access_requests: [],
    notifications: [],
    chat_messages: [],
    nextId: { admins: 1, items: 1, access_requests: 1, notifications: 1, chat_messages: 1 },
    revision: Date.now(),
  };
}

function countsFrom(db) {
  return {
    admins: (db.admins || []).length,
    items: (db.items || []).length,
    access_requests: (db.access_requests || []).length,
    notifications: (db.notifications || []).length,
    chat_messages: (db.chat_messages || []).length,
  };
}

async function kvScan(pattern) {
  const url = String(process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV not configured');

  const keys = [];
  let cursor = '0';
  do {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 100]),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `KV SCAN failed ${res.status}`);
    const result = data.result || [];
    cursor = String(result[0] || '0');
    keys.push(...(result[1] || []));
  } while (cursor !== '0');
  return keys;
}

async function kvDelMany(keys) {
  if (!keys.length) return 0;
  const url = String(process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['DEL', ...keys]),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `KV DEL failed ${res.status}`);
  return data.result || 0;
}

async function wipeKv() {
  if (!useKv()) {
    console.log('Redis/KV not configured — skip live database.');
    return false;
  }

  console.log('Wiping live Redis database…');
  const current = (await loadJsonDb()) || emptyDb();
  console.log('Before (live):', countsFrom(current));

  for (const item of current.items || []) {
    if (!item || !item.filename) continue;
    try { await deleteFileChunks(item.filename); } catch (err) {
      console.warn('File delete skip:', err.message);
    }
  }
  for (const admin of current.admins || []) {
    if (!admin || !admin.avatar) continue;
    try { await deleteFileChunks(admin.avatar); } catch (_) {}
  }

  for (const pattern of ['se:file:*', 'se:up:*']) {
    try {
      const keys = await kvScan(pattern);
      if (keys.length) {
        for (let i = 0; i < keys.length; i += 50) {
          await kvDelMany(keys.slice(i, i + 50));
        }
        console.log(`Cleared ${keys.length} key(s) for ${pattern}`);
      }
    } catch (err) {
      console.warn(`${pattern} sweep:`, err.message);
    }
  }

  await saveJsonDb(emptyDb());
  console.log(`Reset ${DB_KEY} to empty.`);
  return true;
}

function mysqlConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (databaseUrl) return { uri: databaseUrl };
  const host = process.env.DB_HOST || process.env.MYSQL_HOST;
  const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || process.env.MYSQL_DB;
  if (!host || !database) return null;
  return {
    host,
    user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASS || process.env.MYSQL_PASSWORD || process.env.MYSQL_PASS || '',
    database,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
  };
}

async function wipeMysql() {
  const cfg = mysqlConfig();
  if (!cfg) {
    console.log('MySQL not configured — skip local database.');
    return false;
  }
  console.log('Wiping local MySQL…');
  const conn = cfg.uri
    ? await mysql.createConnection(cfg.uri)
    : await mysql.createConnection(cfg);
  try {
    const [[before]] = await conn.query(
      `SELECT
        (SELECT COUNT(*) FROM admins) AS admins,
        (SELECT COUNT(*) FROM items) AS items,
        (SELECT COUNT(*) FROM access_requests) AS access_requests,
        (SELECT COUNT(*) FROM notifications) AS notifications,
        (SELECT COUNT(*) FROM chat_messages) AS chat_messages`,
    );
    console.log('Before (local):', JSON.parse(JSON.stringify(before)));
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['chat_messages', 'notifications', 'access_requests', 'items', 'admins']) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Local MySQL is empty.');
  } finally {
    await conn.end();
  }
  return true;
}

function wipeLocalUploads() {
  const roots = [
    path.join(__dirname, '..', 'uploads'),
    path.join(__dirname, '..', 'server', 'uploads'),
  ];
  let removed = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (name === '.gitkeep') continue;
        fs.unlinkSync(full);
        removed += 1;
      }
    };
    walk(root);
  }
  console.log(`Removed ${removed} local upload file(s).`);
}

async function main() {
  const kv = await wipeKv();
  const mysqlWiped = await wipeMysql();
  wipeLocalUploads();
  if (!kv && !mysqlWiped) {
    console.error('Nothing to wipe. Set KV credentials and/or local MySQL.');
    process.exit(1);
  }
  console.log('Done. The site is empty — sign up to start again.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
