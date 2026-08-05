const crypto = require('crypto');

const AUTH_COOKIE = 'se_auth';
const AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function authSecret() {
  return process.env.SESSION_SECRET || 'shree-extract-secret-change-me';
}

function isProd() {
  return !!process.env.VERCEL || process.env.NODE_ENV === 'production';
}

function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    path: '/',
    maxAge,
  };
}

function signAuth(user) {
  const payload = {
    id: Number(user.id),
    username: String(user.username || ''),
    avatar: user.avatar || null,
    exp: Date.now() + AUTH_MAX_AGE_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', authSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readAuthCookie(req) {
  const raw = req.cookies && req.cookies[AUTH_COOKIE];
  if (!raw || typeof raw !== 'string' || !raw.includes('.')) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', authSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.id || !payload.exp || Number(payload.exp) < Date.now()) return null;
    return {
      id: Number(payload.id),
      username: String(payload.username || ''),
      avatar: payload.avatar || null,
    };
  } catch (_) {
    return null;
  }
}

function requireAuth(req, res, next) {
  if (!getSessionUser(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

function optionalAuth(req, res, next) {
  return next();
}

function getSessionUser(req) {
  const fromCookie = readAuthCookie(req);
  if (fromCookie) return fromCookie;
  if (!req.session || !req.session.adminId) return null;
  return {
    id: Number(req.session.adminId),
    username: req.session.adminUsername,
    avatar: req.session.adminAvatar || null,
  };
}

function setSessionUser(req, res, user) {
  if (!req.session) req.session = {};
  req.session.adminId = Number(user.id);
  req.session.adminUsername = String(user.username || '');
  req.session.adminAvatar = user.avatar || null;
  if (res && typeof res.cookie === 'function') {
    res.cookie(AUTH_COOKIE, signAuth(user), cookieOpts(AUTH_MAX_AGE_MS));
  }
}

function clearCookieOpts() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
  };
}

function clearAuthCookies(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  const opts = clearCookieOpts();
  // Must match Set-Cookie flags or browsers keep the Secure session cookies.
  res.clearCookie(AUTH_COOKIE, opts);
  res.clearCookie('se_session', opts);
  res.clearCookie('se_session.sig', opts);
  res.clearCookie('connect.sid', opts);
}

function clearSessionUser(req, res) {
  if (req.session) {
    delete req.session.adminId;
    delete req.session.adminUsername;
    delete req.session.adminAvatar;
  }
  // cookie-session: null session expires the signed pair on the response.
  try {
    req.session = null;
  } catch (_) {}
  clearAuthCookies(res);
}

function ensureVisitor(req, res, next) {
  let token = req.cookies && req.cookies.se_visitor;
  if (!token || typeof token !== 'string' || token.length < 16) {
    token = crypto.randomBytes(16).toString('hex');
    res.cookie('se_visitor', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd(),
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  req.visitorToken = token;
  return next();
}

module.exports = {
  AUTH_COOKIE,
  requireAuth,
  optionalAuth,
  getSessionUser,
  setSessionUser,
  clearSessionUser,
  clearAuthCookies,
  ensureVisitor,
};
