const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  parseUsername,
  usernameKey,
  usernamesMatch,
  usernameTakenMessage,
  PASSWORD_MIN_LENGTH,
  avatarUrl,
} = require('../utils');
const {
  requireAuth,
  getSessionUser,
  setSessionUser,
  clearSessionUser,
  clearAuthCookies,
} = require('../middleware/auth');

const router = express.Router();

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;
const authAttempts = new Map();

function looksLikeBcrypt(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);
}

function clientKey(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
}

function tooManyAuthAttempts(req) {
  const key = clientKey(req);
  const now = Date.now();
  const rec = authAttempts.get(key) || { n: 0, t: now };
  if (now - rec.t > AUTH_WINDOW_MS) {
    rec.n = 0;
    rec.t = now;
  }
  rec.n += 1;
  authAttempts.set(key, rec);
  return rec.n > AUTH_MAX_ATTEMPTS;
}

async function usernameTaken(username, exceptId = null) {
  const rows = await query('SELECT id, username FROM admins');
  for (const u of rows) {
    if (exceptId != null && Number(u.id) === Number(exceptId)) continue;
    if (usernamesMatch(username, u.username)) return true;
  }
  return false;
}

async function findAdminByUsername(raw) {
  const [normalized] = parseUsername(raw);
  const key = usernameKey(normalized || raw);
  if (!key) return null;
  const exact = await query(
    'SELECT id, username, password_hash, avatar FROM admins WHERE username = :u LIMIT 1',
    { u: normalized || key },
  );
  if (exact[0]) return exact[0];
  const rows = await query('SELECT id, username FROM admins');
  const match = rows.find((u) => usernamesMatch(key, u.username));
  if (!match) return null;
  const full = await query(
    'SELECT id, username, password_hash, avatar FROM admins WHERE id = :id LIMIT 1',
    { id: match.id },
  );
  return full[0] || null;
}

router.get('/check-username', async (req, res) => {
  try {
    const [normalized, userError] = parseUsername(req.query.u || req.query.username || '');
    if (userError) {
      return res.json({ ok: true, available: false, username: null, error: userError });
    }
    const taken = await usernameTaken(normalized);
    return res.json({
      ok: true,
      available: !taken,
      username: normalized,
      error: taken ? usernameTakenMessage() : null,
    });
  } catch (err) {
    console.error('check-username', err);
    return res.status(500).json({ ok: false, available: false, error: 'Could not check username.' });
  }
});

router.post('/local-session', (_req, res) => {
  return res.status(403).json({ ok: false, error: 'Sign in with your username and password.' });
});

router.post('/register', async (req, res) => {
  try {
    if (tooManyAuthAttempts(req)) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
    }
    const { username, password, confirm } = req.body || {};
    const [normalized, userError] = parseUsername(username);
    if (userError) return res.status(400).json({ ok: false, error: userError });
    if (String(password || '').length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({ ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
    }
    if (password !== confirm) {
      return res.status(400).json({ ok: false, error: 'Passwords do not match.' });
    }
    if (await usernameTaken(normalized)) {
      return res.status(409).json({
        ok: false,
        error: usernameTakenMessage(),
        code: 'USERNAME_TAKEN',
      });
    }
    const hash = await bcrypt.hash(String(password), 10);
    let result;
    try {
      result = await query(
        'INSERT INTO admins (username, password_hash) VALUES (:username, :hash)',
        { username: normalized, hash },
      );
    } catch (insertErr) {
      if (insertErr && (insertErr.code === 'USERNAME_TAKEN' || /USERNAME_TAKEN/i.test(insertErr.message || ''))) {
        return res.status(409).json({
          ok: false,
          error: usernameTakenMessage(),
          code: 'USERNAME_TAKEN',
        });
      }
      throw insertErr;
    }
    const user = { id: result.insertId, username: normalized, avatar: null };
    setSessionUser(req, res, user);
    return res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('register', err);
    return res.status(500).json({ ok: false, error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    if (tooManyAuthAttempts(req)) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
    }
    const [normalized, userError] = parseUsername((req.body && req.body.username) || '');
    if (userError) {
      return res.status(400).json({ ok: false, error: userError });
    }
    const password = (req.body && req.body.password) || '';
    if (!String(password)) {
      return res.status(400).json({ ok: false, error: 'Enter your password.' });
    }
    const user = await findAdminByUsername(normalized);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'No account with that username.' });
    }
    const hash = String(user.password_hash || '');
    if (!looksLikeBcrypt(hash)) {
      return res.status(401).json({ ok: false, error: 'Wrong password.' });
    }
    const ok = await bcrypt.compare(String(password), hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Wrong password.' });
    }
    setSessionUser(req, res, user);
    return res.json({
      ok: true,
      user: { id: user.id, username: user.username, avatar: user.avatar || null },
    });
  } catch (err) {
    console.error('login', err);
    return res.status(500).json({ ok: false, error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionUser(req, res);
  // Belt-and-suspenders in case session middleware already ran.
  try { req.session = null; } catch (_) {}
  clearAuthCookies(res);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.json({ ok: true, user: null });
  }
  try {
    const rows = await query(
      'SELECT id, username, avatar FROM admins WHERE id = :id LIMIT 1',
      { id: sessionUser.id },
    );
    const user = rows[0];
    if (!user) {
      clearSessionUser(req, res);
      return res.json({ ok: true, user: null });
    }
    setSessionUser(req, res, user);
    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        avatar_url: avatarUrl(user.avatar, user.id),
      },
    });
  } catch (err) {
    console.error('me', err);
    return res.status(500).json({ ok: false, error: 'Could not load session.' });
  }
});

router.get('/ping', requireAuth, (req, res) => {
  res.json({ ok: true, user: getSessionUser(req) });
});

module.exports = router;
