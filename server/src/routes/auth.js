const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  parseUsername,
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
} = require('../middleware/auth');

const router = express.Router();

async function usernameTaken(username, exceptId = null) {
  const rows = await query('SELECT id, username FROM admins');
  for (const u of rows) {
    if (exceptId != null && Number(u.id) === Number(exceptId)) continue;
    if (usernamesMatch(username, u.username)) return true;
  }
  return false;
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

router.post('/register', async (req, res) => {
  try {
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
    let userKey = String((req.body && req.body.username) || '').toLowerCase().trim();
    const [normalized] = parseUsername(userKey);
    if (normalized) userKey = normalized;
    const password = (req.body && req.body.password) || '';
    const rows = await query('SELECT id, username, password_hash, avatar FROM admins WHERE username = :u LIMIT 1', { u: userKey });
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
    }
    setSessionUser(req, res, user);
    return res.json({ ok: true });
  } catch (err) {
    console.error('login', err);
    return res.status(500).json({ ok: false, error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionUser(req, res);
  req.session = null;
  res.clearCookie('se_session', { path: '/' });
  res.clearCookie('se_auth', { path: '/' });
  res.clearCookie('connect.sid', { path: '/' });
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
