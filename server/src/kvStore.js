const DB_KEY = 'se:db:json';
const FILE_PREFIX = 'se:file:';
const UPLOAD_PREFIX = 'se:up:';
const CHUNK_SIZE = 700000; // stay under Upstash free value limits
// Stay under both Vercel's ~4.5 MB body limit and Upstash value size limits.
const CLIENT_CHUNK_BYTES = 700000;

function useKv() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function kvUrl() {
  return String(process.env.KV_REST_API_URL || '').replace(/\/$/, '');
}

function kvHeaders() {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function kvCommand(args) {
  if (!useKv()) throw new Error('KV not configured');
  const res = await fetch(kvUrl(), {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `KV error ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

async function kvPipeline(commands) {
  if (!useKv()) throw new Error('KV not configured');
  if (!commands.length) return [];
  if (commands.length === 1) {
    return [await kvCommand(commands[0])];
  }
  const res = await fetch(`${kvUrl()}/pipeline`, {
    method: 'POST',
    headers: kvHeaders(),
    body: JSON.stringify(commands),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `KV pipeline error ${res.status}`;
    throw new Error(msg);
  }
  if (!Array.isArray(data)) {
    throw new Error('KV pipeline returned unexpected payload');
  }
  return data.map((row) => (row && Object.prototype.hasOwnProperty.call(row, 'result') ? row.result : row));
}

async function kvGet(key) {
  return kvCommand(['GET', key]);
}

async function kvMGet(keys) {
  if (!keys.length) return [];
  return kvPipeline(keys.map((key) => ['GET', key]));
}

async function kvSet(key, value) {
  return kvCommand(['SET', key, value]);
}

async function kvDel(...keys) {
  if (!keys.length) return 0;
  return kvCommand(['DEL', ...keys]);
}

async function loadJsonDb() {
  const raw = await kvGet(DB_KEY);
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  return JSON.parse(String(raw));
}

async function saveJsonDb(db) {
  await kvSet(DB_KEY, JSON.stringify(db));
  return true;
}

async function saveFileChunks(pathname, buffer, contentType) {
  const keyBase = `${FILE_PREFIX}${pathname}`;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
    chunks.push(buf.subarray(i, i + CHUNK_SIZE).toString('base64'));
  }
  const meta = {
    contentType: contentType || 'application/octet-stream',
    size: buf.length,
    chunks: chunks.length,
  };
  // delete old chunks first (best-effort)
  try {
    const old = await kvGet(`${keyBase}:meta`);
    if (old) {
      const parsed = typeof old === 'string' ? JSON.parse(old) : old;
      const n = Number(parsed.chunks || 0);
      const keys = [`${keyBase}:meta`];
      for (let i = 0; i < n; i += 1) keys.push(`${keyBase}:${i}`);
      await kvDel(...keys);
    }
  } catch (_) {}

  await kvSet(`${keyBase}:meta`, JSON.stringify(meta));
  for (let i = 0; i < chunks.length; i += 1) {
    await kvSet(`${keyBase}:${i}`, chunks[i]);
  }
  return `kv://${pathname}`;
}

async function readFileChunks(pathnameOrKvUrl) {
  const pathname = String(pathnameOrKvUrl || '').replace(/^kv:\/\//, '');
  const keyBase = `${FILE_PREFIX}${pathname}`;
  const metaRaw = await kvGet(`${keyBase}:meta`);
  if (!metaRaw) throw new Error('File not found');
  const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
  const parts = [];
  for (let i = 0; i < Number(meta.chunks || 0); i += 1) {
    const chunk = await kvGet(`${keyBase}:${i}`);
    if (!chunk) throw new Error('File chunk missing');
    parts.push(Buffer.from(String(chunk), 'base64'));
  }
  return {
    buffer: Buffer.concat(parts),
    contentType: meta.contentType || 'application/octet-stream',
    size: meta.size,
  };
}

async function deleteFileChunks(pathnameOrKvUrl) {
  const pathname = String(pathnameOrKvUrl || '').replace(/^kv:\/\//, '');
  const keyBase = `${FILE_PREFIX}${pathname}`;
  try {
    const metaRaw = await kvGet(`${keyBase}:meta`);
    const keys = [`${keyBase}:meta`];
    if (metaRaw) {
      const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
      for (let i = 0; i < Number(meta.chunks || 0); i += 1) keys.push(`${keyBase}:${i}`);
    }
    await kvDel(...keys);
  } catch (err) {
    console.warn('kv file delete:', err.message);
  }
}

function isKvUrl(value) {
  return typeof value === 'string' && value.startsWith('kv://');
}

async function saveUploadMeta(uploadId, meta) {
  await kvSet(`${UPLOAD_PREFIX}${uploadId}:meta`, JSON.stringify(meta));
}

async function loadUploadMeta(uploadId) {
  const raw = await kvGet(`${UPLOAD_PREFIX}${uploadId}:meta`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveUploadChunk(uploadId, index, buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await kvSet(`${UPLOAD_PREFIX}${uploadId}:c:${index}`, buf.toString('base64'));
}

async function loadUploadChunks(uploadId, chunkCount) {
  const parts = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = await kvGet(`${UPLOAD_PREFIX}${uploadId}:c:${i}`);
    if (!chunk) throw new Error(`Missing upload chunk ${i}`);
    parts.push(Buffer.from(String(chunk), 'base64'));
  }
  return Buffer.concat(parts);
}

async function saveFileChunkAt(storedName, index, buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await kvSet(`${FILE_PREFIX}${storedName}:${index}`, buf.toString('base64'));
}

async function markUploadChunkReceived(uploadId, index) {
  // Per-chunk keys avoid race conditions when many parts upload in parallel.
  await kvSet(`${UPLOAD_PREFIX}${uploadId}:r:${index}`, '1');
}

async function missingFileChunks(storedName, chunkCount) {
  const missing = [];
  const n = Number(chunkCount) || 0;
  const batch = 40;
  for (let off = 0; off < n; off += batch) {
    const keys = [];
    for (let i = off; i < Math.min(n, off + batch); i += 1) {
      keys.push(`${FILE_PREFIX}${storedName}:${i}`);
    }
    const vals = await kvMGet(keys);
    for (let i = 0; i < vals.length; i += 1) {
      if (!vals[i]) missing.push(off + i);
    }
  }
  return missing;
}

async function finalizeChunkedFile(storedName, chunkCount, contentType, size) {
  const fileBase = `${FILE_PREFIX}${storedName}`;
  const meta = {
    contentType: contentType || 'application/octet-stream',
    size: Number(size) || 0,
    chunks: Number(chunkCount) || 0,
    chunkBytes: CHUNK_SIZE,
  };
  await kvSet(`${fileBase}:meta`, JSON.stringify(meta));
  return `kv://${storedName}`;
}

/** Promote staged upload chunks to a stored file without assembling in memory. */
async function promoteUploadToFile(uploadId, storedName, chunkCount, contentType, size) {
  for (let i = 0; i < Number(chunkCount); i += 1) {
    const chunk = await kvGet(`${UPLOAD_PREFIX}${uploadId}:c:${i}`);
    if (!chunk) throw new Error(`Missing upload chunk ${i}`);
    await kvSet(`${FILE_PREFIX}${storedName}:${i}`, chunk);
  }
  await deleteUploadSession(uploadId, chunkCount);
  return finalizeChunkedFile(storedName, chunkCount, contentType, size);
}

async function getFileMeta(pathnameOrKvUrl) {
  const pathname = String(pathnameOrKvUrl || '').replace(/^kv:\/\//, '');
  const keyBase = `${FILE_PREFIX}${pathname}`;
  const metaRaw = await kvGet(`${keyBase}:meta`);
  if (!metaRaw) throw new Error('File not found');
  const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
  return {
    pathname,
    contentType: meta.contentType || 'application/octet-stream',
    size: Number(meta.size || 0),
    chunks: Number(meta.chunks || 0),
    chunkBytes: Number(meta.chunkBytes || CHUNK_SIZE),
  };
}

/** Read a byte range (inclusive end) from a chunked KV file without loading the whole object. */
async function readFileRange(pathnameOrKvUrl, start, end) {
  const meta = await getFileMeta(pathnameOrKvUrl);
  const size = meta.size;
  const from = Math.max(0, Number(start) || 0);
  const to = Math.min(size - 1, Number(end) || (size - 1));
  if (size < 1 || from > to) {
    return { buffer: Buffer.alloc(0), contentType: meta.contentType, size, start: 0, end: -1 };
  }
  const chunkBytes = meta.chunkBytes || CHUNK_SIZE;
  const first = Math.floor(from / chunkBytes);
  const last = Math.floor(to / chunkBytes);
  const keys = [];
  for (let i = first; i <= last; i += 1) {
    keys.push(`${FILE_PREFIX}${meta.pathname}:${i}`);
  }
  // Fetch all needed chunks in one pipeline round-trip (much smoother for video seek).
  const rawParts = await kvMGet(keys);
  const parts = [];
  for (let i = 0; i < rawParts.length; i += 1) {
    if (!rawParts[i]) throw new Error(`File chunk missing (${first + i})`);
    parts.push(Buffer.from(String(rawParts[i]), 'base64'));
  }
  const joined = Buffer.concat(parts);
  const localStart = from - first * chunkBytes;
  const localEnd = localStart + (to - from);
  return {
    buffer: joined.subarray(localStart, localEnd + 1),
    contentType: meta.contentType,
    size,
    start: from,
    end: to,
  };
}

async function deleteUploadSession(uploadId, chunkCount = 0) {
  const keys = [`${UPLOAD_PREFIX}${uploadId}:meta`];
  const n = Number(chunkCount || 0);
  for (let i = 0; i < n; i += 1) {
    keys.push(`${UPLOAD_PREFIX}${uploadId}:c:${i}`);
    keys.push(`${UPLOAD_PREFIX}${uploadId}:r:${i}`);
  }
  try {
    // Delete in batches — large uploads can have hundreds of receipt keys.
    for (let i = 0; i < keys.length; i += 40) {
      await kvDel(...keys.slice(i, i + 40));
    }
  } catch (_) {}
}

module.exports = {
  useKv,
  loadJsonDb,
  saveJsonDb,
  saveFileChunks,
  readFileChunks,
  readFileRange,
  getFileMeta,
  deleteFileChunks,
  saveUploadMeta,
  loadUploadMeta,
  saveUploadChunk,
  saveFileChunkAt,
  markUploadChunkReceived,
  missingFileChunks,
  finalizeChunkedFile,
  loadUploadChunks,
  promoteUploadToFile,
  deleteUploadSession,
  isKvUrl,
  DB_KEY,
  CLIENT_CHUNK_BYTES,
  CHUNK_SIZE,
};
