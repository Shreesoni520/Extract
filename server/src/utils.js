const crypto = require('crypto');

const PASSWORD_TTL_SECONDS = 300;
const UNLOCK_TTL_SECONDS = 300;
const PASSWORD_MIN_LENGTH = 4;
// App ceiling. Effective max depends on storage backend (S3/R2 vs Redis).
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const KV_UPLOAD_MAX_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB via Redis chunks

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = Number(bytes) || 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${Math.round(n * 10) / 10} ${units[i]}`;
}

function isPreviewable(mime) {
  const m = mime || '';
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/')
    || m === 'application/pdf' || m.startsWith('text/');
}

function generatePassword(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function sqlFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function secondsLeft(sqlDatetime) {
  if (!sqlDatetime) return 0;
  const t = Date.parse(String(sqlDatetime).replace(' ', 'T'));
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

function parseUsername(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [null, 'Enter a username.'];
  if (!/^[a-zA-Z0-9._]{3,20}$/.test(trimmed)) {
    return [null, 'Username must be 3-20 letters, numbers, dots, or underscores.'];
  }
  return [trimmed.toLowerCase(), null];
}

function usernameKey(raw) {
  return String(raw || '').toLowerCase().trim().replace(/\.+$/g, '');
}

function usernameDotVariantCollision(attempt, existing) {
  const a = usernameKey(attempt);
  const e = usernameKey(existing);
  if (!a || !e) return false;
  if (a === e) return true;
  // Block trailing-dot / punctuation-only variants of the same base.
  const aBase = a.replace(/[._-]+$/g, '');
  const eBase = e.replace(/[._-]+$/g, '');
  if (aBase.length < 3 || aBase !== eBase) return false;
  return a !== aBase || e !== eBase;
}

function usernamesMatch(a, b) {
  return usernameKey(a) === usernameKey(b) || usernameDotVariantCollision(a, b);
}

function usernameTakenMessage() {
  return 'That username is taken.';
}

function avatarUrl(filename, userId) {
  if (filename && /^https?:\/\//i.test(filename)) return filename;
  if (filename) return `/api/avatar?f=${encodeURIComponent(filename)}`;
  return `/api/avatar?u=${userId || 0}`;
}

function randomFilename(originalName) {
  const ext = String(originalName || '').split('.').pop() || '';
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const hex = crypto.randomBytes(16).toString('hex');
  return safeExt ? `${hex}.${safeExt}` : hex;
}

module.exports = {
  PASSWORD_TTL_SECONDS,
  UNLOCK_TTL_SECONDS,
  PASSWORD_MIN_LENGTH,
  MAX_UPLOAD_BYTES,
  KV_UPLOAD_MAX_BYTES,
  formatBytes,
  isPreviewable,
  generatePassword,
  nowSql,
  sqlFromMs,
  secondsLeft,
  parseUsername,
  usernameKey,
  usernamesMatch,
  usernameDotVariantCollision,
  usernameTakenMessage,
  avatarUrl,
  randomFilename,
};
