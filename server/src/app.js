const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { router: filesRoutes } = require('./routes/files');
const { ensureVisitor } = require('./middleware/auth');

const EXTRACT_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_ROOT = path.join(EXTRACT_ROOT, 'public');
const PAGES_ROOT = path.join(__dirname, '..', 'pages');

function sendProtectedPage(pageName) {
  return (req, res) => {
    const filePath = path.join(PAGES_ROOT, pageName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Not found');
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    return res.sendFile(filePath);
  };
}

function createApp() {
  const app = express();
  const isVercel = !!process.env.VERCEL;
  const isProd = isVercel || process.env.NODE_ENV === 'production';
  const staticRoot = fs.existsSync(PUBLIC_ROOT) ? PUBLIC_ROOT : EXTRACT_ROOT;
  const sessionSecret = process.env.SESSION_SECRET || 'shree-extract-secret-change-me';

  app.set('trust proxy', 1);
  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Cookie-backed session so login survives Vercel serverless (no memory store).
  app.use(cookieSession({
    name: 'se_session',
    keys: [sessionSecret, `${sessionSecret}-fallback`],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  }));
  app.use(ensureVisitor);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: "Shree's Extractions" });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', filesRoutes);
  app.use('/api', apiRoutes);

  app.get(['/login', '/login.html'], (_req, res) => {
    return res.sendFile(path.join(PUBLIC_ROOT, 'app', 'login.html'));
  });
  app.get(['/register', '/register.html'], (_req, res) => {
    return res.sendFile(path.join(PUBLIC_ROOT, 'app', 'register.html'));
  });
  app.get([
    '/app/login.html',
    '/Extract/app/login.html',
    '/Extract/login',
    '/Extract/login.html',
  ], (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/login${qs}`);
  });
  app.get([
    '/app/register.html',
    '/Extract/app/register.html',
    '/Extract/register',
    '/Extract/register.html',
  ], (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/register${qs}`);
  });

  // App pages — local login is enough; do not bounce guests with a server cookie check.
  app.get('/app/index.html', sendProtectedPage('index.html'));
  app.get('/app/account.html', sendProtectedPage('account.html'));
  app.get('/app/users.html', sendProtectedPage('users.html'));
  app.get('/Extract/app/index.html', sendProtectedPage('index.html'));
  app.get('/Extract/app/account.html', sendProtectedPage('account.html'));
  app.get('/Extract/app/users.html', sendProtectedPage('users.html'));

  // Prefer public/ on Vercel; fall back to Extract root for local XAMPP.
  // Vercel also serves public/ as static CDN assets; express.static is ignored there.
  app.use(express.static(staticRoot));
  app.use('/Extract', express.static(staticRoot));

  // Legacy /Extract URLs and unknown pages always land on the home page.
  app.get(['/Extract', '/Extract/', '/Extract/index.html', '/home', '/home.html'], (_req, res) => {
    res.redirect(302, '/');
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/assets')) return next();
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|wav|mp3|map|txt|json|woff2?)$/i.test(req.path)) {
      return next();
    }
    const allowed = new Set([
      '/',
      '/index.html',
      '/download.html',
      '/favicon.ico',
      '/login',
      '/register',
      '/login.html',
      '/register.html',
      '/app/login.html',
      '/app/register.html',
      '/app/index.html',
      '/app/account.html',
      '/app/users.html',
    ]);
    if (allowed.has(req.path)) return next();
    if (req.accepts('html')) return res.redirect(302, '/');
    return next();
  });

  return app;
}

module.exports = { createApp, EXTRACT_ROOT };
