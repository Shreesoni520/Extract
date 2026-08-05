const crypto = require('crypto');

const PASSWORD_TTL_SECONDS = 300;
const UNLOCK_TTL_SECONDS = 300;
const PASSWORD_MIN_LENGTH = 8;
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
  let user = String(raw || '').toLowerCase().trim();
  if (!user) return [null, 'Enter a username.'];

  // People sometimes paste an email — this app uses usernames, not emails.
  if (user.includes('@')) {
    return [null, 'Use a username, not an email. Pick a unique name like yourname.'];
  }

  // Normalize lookalikes so "John_Doe", "john.doe", "john-doe" collide less sneakily
  // only for trailing junk; keep dots/underscores as distinct names otherwise.
  user = user.replace(/^\.+|\.+$/g, '');

  if (user.length < 3) return [null, 'Username must be at least 3 characters.'];
  if (user.length > 32) return [null, 'Username must be 32 characters or fewer.'];
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) {
    return [null, 'Use 3–32 characters: lowercase letters, numbers, and you can use dots, underscores, or hyphens. Must start with a letter or number.'];
  }
  if (/(\.\.|__|--)/.test(user)) {
    return [null, 'Username cannot use repeated dots, underscores, or hyphens.'];
  }
  return [user, null];
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
  return 'That username is already registered. Sign in instead, or choose a different username.';
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
