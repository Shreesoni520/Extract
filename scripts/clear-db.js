/**
 * Wipe Redis/KV app data so production starts fresh.
 * Keeps code + env config. Deletes users, files metadata, requests, notifications,
 * and stored file chunks under se:file:*.
 */
const path = require('path');
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
    const batch = result[1] || [];
    keys.push(...batch);
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

async function main() {
  if (!useKv()) {
    console.error('KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.');
    process.exit(1);
  }

  console.log('Loading current DB…');
  const current = (await loadJsonDb()) || emptyDb();
  const counts = {
    admins: (current.admins || []).length,
    items: (current.items || []).length,
    access_requests: (current.access_requests || []).length,
    notifications: (current.notifications || []).length,
    chat_messages: (current.chat_messages || []).length,
  };
  console.log('Before:', counts);

  // Delete file chunks referenced by items first.
  let filesDeleted = 0;
  for (const item of current.items || []) {
    if (!item || !item.filename) continue;
    try {
      await deleteFileChunks(item.filename);
      filesDeleted += 1;
    } catch (err) {
      console.warn('File delete skip:', err.message);
    }
  }

  // Sweep leftover file + upload session keys.
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

  // Reset JSON DB to empty (users, files, requests, chats, notifications).
  await saveJsonDb(emptyDb());
  console.log(`Reset ${DB_KEY} to empty.`);
  console.log(`Removed file records: ${filesDeleted}`);
  console.log('Done. Fresh project database is empty and ready.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
