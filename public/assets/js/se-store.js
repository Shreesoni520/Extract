(function (global) {
  'use strict';

  const CFG = {
    passwordTtlSeconds: 300,
    unlockTtlSeconds: 300,
    maxUploadBytes: 50 * 1024 * 1024,
    passwordMinLength: 4,
    appName: "Shree's Extractions",
  };

  let root = '';
  const cur = global.document && global.document.currentScript;
  if (cur && cur.src) {
    try {
      const p = new URL(cur.src, global.location.href).pathname;
      root = p.replace(/\/assets\/js\/se-store\.js(?:\?.*)?$/i, '') || '';
    } catch (_) {}
  }
  // Prefer empty root when served from Node/Vercel at /
  if (!/^\/Extract(\/|$)/i.test(global.location.pathname)) {
    root = '';
  } else if (!root) {
    root = '/Extract';
  }

  let cachedUser = null;
  let ready = null;

  const USERS_KEY = 'se_users_v1';
  const SESSION_KEY = 'se_session_v1';

  function usernameKey(username) {
    return String(username || '').trim().toLowerCase();
  }

  function isValidUsername(username) {
    return /^[a-zA-Z0-9._]{3,20}$/.test(String(username || '').trim());
  }

  function readUsers() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function writeUsers(users) {
    try {
      global.localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (_) {}
  }

  function getSessionUsername() {
    try {
      return global.localStorage.getItem(SESSION_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  function setSessionUsername(username) {
    try {
      if (username) global.localStorage.setItem(SESSION_KEY, username);
      else global.localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function getLocalUser(username) {
    if (!username) return null;
    const users = readUsers();
    return users[usernameKey(username)] || null;
  }

  function saveLocalUser(user) {
    const users = readUsers();
    users[usernameKey(user.username)] = user;
    writeUsers(users);
    return user;
  }

  async function hashPassword(password, salt) {
    const encoded = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function makeSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function apiUrl(path) {
    if (path.startsWith('http')) return path;
    return path.startsWith('/') ? path : `/${path}`;
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    const init = Object.assign({ credentials: 'include' }, opts, { headers });
    if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(apiUrl(path), init);
    const ct = res.headers.get('Content-Type') || '';
    let data = null;
    if (ct.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => '');
      data = {
        ok: res.ok,
        status: res.status,
        error: res.status === 413
          ? 'File is too large for this host in one request. Try again — larger files upload in parts.'
          : (text && text.slice(0, 160)) || `Request failed (${res.status}).`,
      };
    }
    if (!data) {
      data = {
        ok: false,
        status: res.status,
        error: res.status === 413
          ? 'File is too large for this host in one request.'
          : `Request failed (${res.status}).`,
      };
    }
    return { res, data };
  }

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

  function avatarUrl(filename, userId) {
    if (filename) return `/api/avatar?f=${encodeURIComponent(filename)}`;
    return `/api/avatar?u=${userId || 0}`;
  }

  function getCurrentUser() {
    return cachedUser;
  }

  function localAccountFromSession() {
    const session = getSessionUsername();
    return session ? getLocalUser(session) : null;
  }

  function adminLoggedIn() {
    return !!(cachedUser && cachedUser.username && localAccountFromSession());
  }

  function readUserHint() {
    const local = localAccountFromSession();
    if (local && local.username) {
      return { id: (cachedUser && cachedUser.id) || 0, username: local.username };
    }
    try {
      const raw = sessionStorage.getItem('se_user_hint');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeUserHint(user) {
    try {
      if (user && user.username) {
        sessionStorage.setItem('se_user_hint', JSON.stringify({
          id: user.id,
          username: user.username,
        }));
      } else {
        sessionStorage.removeItem('se_user_hint');
      }
    } catch (_) {}
  }

  function paintLocalUser(account, extra) {
    cachedUser = {
      id: extra && extra.id ? Number(extra.id) : ((cachedUser && cachedUser.id) || 0),
      username: account.username,
      avatar: extra && extra.avatar ? extra.avatar : ((cachedUser && cachedUser.avatar) || null),
    };
    setSessionUsername(account.username);
    writeUserHint(cachedUser);
    return cachedUser;
  }

  async function ensureServerSession(username) {
    const call = api('/api/auth/local-session', {
      method: 'POST',
      body: { username },
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ data: null }), 4000));
    const { data } = await Promise.race([call, timeout]);
    if (data && data.ok && data.user) {
      const local = getLocalUser(username) || { username: data.user.username };
      paintLocalUser(local, data.user);
      return cachedUser;
    }
    return cachedUser;
  }

  async function refreshMe() {
    const local = localAccountFromSession();
    if (!local) {
      cachedUser = null;
      writeUserHint(null);
      try {
        global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: null }));
      } catch (_) {}
      return null;
    }
    paintLocalUser(local, cachedUser);
    try {
      await ensureServerSession(local.username);
    } catch (_) {}
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
    } catch (_) {}
    return cachedUser;
  }

  async function init(opts) {
    const force = !!(opts && opts.force);
    if (force) {
      ready = null;
      cachedUser = null;
    }
    const local = localAccountFromSession();
    if (local) {
      paintLocalUser(local, cachedUser);
    } else {
      cachedUser = null;
      writeUserHint(null);
    }
    if (!ready) {
      ready = Promise.resolve(cachedUser);
      if (local) {
        ensureServerSession(local.username).catch(() => {});
      }
    }
    return cachedUser;
  }

  function whenReady() {
    return ready || Promise.resolve(cachedUser);
  }

  async function register(username, password, confirm) {
    const trimmed = String(username || '').trim();
    if (!isValidUsername(trimmed)) {
      return { ok: false, error: 'Username must be 3-20 letters, numbers, dots, or underscores.' };
    }
    if (String(password || '').length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters.' };
    }
    if (password !== confirm) {
      return { ok: false, error: 'Passwords do not match.' };
    }
    if (getLocalUser(trimmed)) {
      return { ok: false, error: 'That username is taken.', code: 'USERNAME_TAKEN' };
    }
    const salt = makeSalt();
    const passwordHash = await hashPassword(String(password), salt);
    const account = {
      username: trimmed,
      passwordHash,
      salt,
      createdAt: Date.now(),
    };
    saveLocalUser(account);
    paintLocalUser(account);
    ensureServerSession(account.username).catch(() => {});
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
    } catch (_) {}
    return { ok: true, user: cachedUser };
  }

  async function login(username, password) {
    const existing = getLocalUser(username);
    if (!existing) return { ok: false, error: 'No account with that username.' };
    const hash = await hashPassword(String(password || ''), existing.salt);
    if (hash !== existing.passwordHash) return { ok: false, error: 'Wrong password.' };
    paintLocalUser(existing);
    ensureServerSession(existing.username).catch(() => {});
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
    } catch (_) {}
    return { ok: true, user: cachedUser };
  }

  async function logout() {
    setSessionUsername(null);
    cachedUser = null;
    writeUserHint(null);
    ready = null;
    try { sessionStorage.removeItem('se_user_hint'); } catch (_) {}
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        body: {},
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (_) {}
    cachedUser = null;
    writeUserHint(null);
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: null }));
    } catch (_) {}
  }

  async function changeLocalPassword(currentPassword, newPassword, confirmPassword) {
    const account = localAccountFromSession();
    if (!account) return { ok: false, error: 'Not logged in.' };
    if (String(newPassword || '').length < 4) {
      return { ok: false, error: 'Password must be at least 4 characters.' };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }
    const currentHash = await hashPassword(String(currentPassword || ''), account.salt);
    if (currentHash !== account.passwordHash) {
      return { ok: false, error: 'Wrong password.', code: 'BAD_CURRENT_PASSWORD' };
    }
    const salt = makeSalt();
    account.salt = salt;
    account.passwordHash = await hashPassword(String(newPassword), salt);
    saveLocalUser(account);
    return { ok: true, message: 'Password updated. Use the new password next time you sign in.' };
  }

  async function renameLocalAccount(newUsername) {
    const account = localAccountFromSession();
    if (!account) return { ok: false, error: 'Not logged in.' };
    const trimmed = String(newUsername || '').trim();
    if (!isValidUsername(trimmed)) {
      return { ok: false, error: 'Username must be 3-20 letters, numbers, dots, or underscores.' };
    }
    const other = getLocalUser(trimmed);
    if (other && usernameKey(other.username) !== usernameKey(account.username)) {
      return { ok: false, error: 'That username is taken.', code: 'USERNAME_TAKEN' };
    }
    const users = readUsers();
    delete users[usernameKey(account.username)];
    account.username = trimmed;
    users[usernameKey(trimmed)] = account;
    writeUsers(users);
    paintLocalUser(account, cachedUser);
    return { ok: true, username: trimmed };
  }

  async function searchUsers(q) {
    const { data } = await api(`/api/users?q=${encodeURIComponent(q || '')}`);
    return data || { ok: false, users: [] };
  }

  async function listItemsForUser(userId) {
    const { data } = await api(`/api/items?user_id=${encodeURIComponent(userId)}`);
    return data || { ok: false, items: [] };
  }

  async function checkAccess(itemId) {
    const { data } = await api(`/api/check-access?item_id=${encodeURIComponent(itemId)}`);
    return data || { ok: false, status: 'missing' };
  }

  async function requestAccess(itemId) {
    const { data } = await api('/api/request-access', {
      method: 'POST',
      body: { item_id: itemId },
    });
    return data || { ok: false, error: 'Request failed' };
  }

  async function verifyPasswordAccess(itemId, password) {
    const { data } = await api('/api/verify-password', {
      method: 'POST',
      body: { item_id: itemId, password },
    });
    return data || { ok: false, error: 'Unlock failed' };
  }

  async function notificationsPayload(_ownerId, sinceId) {
    const { data } = await api(`/api/notifications?since_id=${encodeURIComponent(sinceId || 0)}`);
    return data || { ok: false, notifications: [] };
  }

  async function markNotifications({ all, id }) {
    const { data } = await api('/api/mark-notifications', {
      method: 'POST',
      body: { all: !!all, id: id || 0 },
    });
    return data || { ok: false, error: 'Nothing to mark' };
  }

  async function unreadSummary() {
    const { data } = await api('/api/unread');
    return data || { ok: false, error: 'Unauthorized' };
  }

  async function revokeAccess({ request_id, item_id }) {
    const { data } = await api('/api/revoke-access', {
      method: 'POST',
      body: { request_id, item_id },
    });
    return data || { ok: false, error: 'Could not revoke' };
  }

  async function clearDone({ all, notification_id }) {
    const { data } = await api('/api/clear-done', {
      method: 'POST',
      body: { all: !!all, notification_id: notification_id || 0 },
    });
    return data || { ok: false, error: 'Could not clear' };
  }

  // Vercel Functions reject request bodies over ~4.5 MB — larger files use chunked / S3 upload.
  const DIRECT_UPLOAD_MAX = 3.5 * 1024 * 1024;
  let uploadConfigCache = null;

  async function getUploadConfig() {
    if (uploadConfigCache) return uploadConfigCache;
    const { data } = await api('/api/upload/config');
    uploadConfigCache = data && data.ok
      ? data
      : { ok: true, max_bytes: 1024 * 1024 * 1024, max_label: '1 GB', s3: false, mode: 'kv' };
    return uploadConfigCache;
  }

  async function mapPool(total, concurrency, worker) {
    let next = 0;
    let finished = 0;
    let firstError = null;
    const runners = Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (!firstError) {
        const i = next;
        next += 1;
        if (i >= total) return;
        try {
          await worker(i);
          finished += 1;
        } catch (err) {
          firstError = err;
          return;
        }
      }
    });
    await Promise.all(runners);
    if (firstError) throw firstError;
    return finished;
  }

  async function uploadItemDirect({ title, description, file, require_password }) {
    const fd = new FormData();
    fd.append('title', String(title).trim());
    if (description) fd.append('description', String(description).trim());
    fd.append('file', file);
    fd.append('require_password', require_password ? '1' : '0');
    const { res, data } = await api('/api/upload', { method: 'POST', body: fd });
    if (data && data.ok) return data;
    const code = data && data.code;
    const needChunked = res.status === 413 || code === 'USE_CHUNKED' || code === 'TOO_LARGE';
    return Object.assign({ ok: false, needChunked }, data || { error: 'Upload failed.' });
  }

  async function uploadItemChunked({ title, description, file, require_password, onProgress }) {
    const init = await api('/api/upload/init', {
      method: 'POST',
      body: {
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        require_password: !!require_password,
        original_name: file.name || 'file',
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
      },
    });
    if (!init.data || !init.data.ok) {
      return init.data || { ok: false, error: 'Could not start upload.' };
    }

    const uploadId = init.data.upload_id;
    const chunkBytes = Number(init.data.chunk_bytes) || 700000;
    const totalChunks = Number(init.data.chunks) || Math.ceil(file.size / chunkBytes);
    let completed = 0;

    try {
      await mapPool(totalChunks, 4, async (i) => {
        const start = i * chunkBytes;
        const end = Math.min(file.size, start + chunkBytes);
        const blob = file.slice(start, end);
        const fd = new FormData();
        fd.append('upload_id', uploadId);
        fd.append('index', String(i));
        fd.append('chunk', blob, `${file.name || 'file'}.part${i}`);
        const { res, data } = await api('/api/upload/chunk', { method: 'POST', body: fd });
        if (!data || !data.ok) {
          throw new Error((data && data.error) || `Chunk ${i + 1}/${totalChunks} failed (${res.status}).`);
        }
        completed += 1;
        if (typeof onProgress === 'function') {
          onProgress({
            phase: 'uploading',
            current: completed,
            total: totalChunks,
            percent: Math.round((completed / totalChunks) * 100),
          });
        }
      });
    } catch (err) {
      return { ok: false, error: err.message || 'Upload failed.' };
    }

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'finishing', current: totalChunks, total: totalChunks, percent: 100 });
    }
    const done = await api('/api/upload/complete', {
      method: 'POST',
      body: { upload_id: uploadId },
    });
    return done.data || { ok: false, error: 'Could not finish upload.' };
  }

  async function uploadItemS3({ title, description, file, require_password, onProgress }) {
    const init = await api('/api/upload/s3/init', {
      method: 'POST',
      body: {
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        require_password: !!require_password,
        original_name: file.name || 'file',
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
      },
    });
    if (!init.data || !init.data.ok) {
      return init.data || { ok: false, error: 'Could not start cloud upload.' };
    }

    const key = init.data.key;
    const uploadId = init.data.upload_id;
    const partSize = Number(init.data.part_size) || (8 * 1024 * 1024);
    const totalParts = Number(init.data.parts) || Math.ceil(file.size / partSize);
    const parts = new Array(totalParts);
    let completed = 0;

    try {
      await mapPool(totalParts, 4, async (i) => {
        const partNumber = i + 1;
        const start = i * partSize;
        const end = Math.min(file.size, start + partSize);
        const blob = file.slice(start, end);
        const sign = await api('/api/upload/s3/sign', {
          method: 'POST',
          body: { key, upload_id: uploadId, part_number: partNumber },
        });
        if (!sign.data || !sign.data.ok || !sign.data.urls || !sign.data.urls[0]) {
          throw new Error((sign.data && sign.data.error) || 'Could not sign upload part.');
        }
        const putRes = await fetch(sign.data.urls[0].url, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!putRes.ok) {
          throw new Error(`Cloud part ${partNumber}/${totalParts} failed (${putRes.status}). Check R2 CORS.`);
        }
        const etag = putRes.headers.get('etag') || putRes.headers.get('ETag');
        if (!etag) {
          throw new Error('Cloud storage did not return ETag. Expose ETag in R2/S3 CORS settings.');
        }
        parts[i] = { partNumber, etag };
        completed += 1;
        if (typeof onProgress === 'function') {
          onProgress({
            phase: 'uploading',
            current: completed,
            total: totalParts,
            percent: Math.round((completed / totalParts) * 100),
          });
        }
      });
    } catch (err) {
      return { ok: false, error: err.message || 'Cloud upload failed.' };
    }

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'finishing', current: totalParts, total: totalParts, percent: 100 });
    }
    const done = await api('/api/upload/s3/complete', {
      method: 'POST',
      body: {
        key,
        upload_id: uploadId,
        parts,
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        require_password: !!require_password,
        original_name: file.name || 'file',
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
      },
    });
    return done.data || { ok: false, error: 'Could not finish cloud upload.' };
  }

  async function uploadItem({ title, description, file, require_password, onProgress }) {
    if (!adminLoggedIn()) return { ok: false, error: 'Not logged in.' };
    if (!title || !String(title).trim()) return { ok: false, error: 'Title is required.' };
    if (!file) return { ok: false, error: 'Choose a file to upload.' };

    const cfg = await getUploadConfig();
    const maxBytes = Number(cfg.max_bytes) || (1024 * 1024 * 1024);
    if (file.size > maxBytes) {
      return { ok: false, error: `File is too large (max ${cfg.max_label || formatBytes(maxBytes)}).` };
    }

    if (cfg.s3 && file.size > DIRECT_UPLOAD_MAX) {
      return uploadItemS3({ title, description, file, require_password, onProgress });
    }

    if (file.size <= DIRECT_UPLOAD_MAX) {
      if (typeof onProgress === 'function') onProgress({ phase: 'uploading', percent: 20 });
      const direct = await uploadItemDirect({ title, description, file, require_password });
      if (direct.ok) return direct;
      if (!direct.needChunked) return direct;
    }

    return uploadItemChunked({ title, description, file, require_password, onProgress });
  }

  async function listOwnerItems() {
    const { data } = await api('/api/my-items');
    if (!data || !data.ok) return [];
    return data.items || [];
  }

  async function togglePassword(itemId) {
    const { data } = await api(`/api/items/${itemId}/toggle-password`, { method: 'POST', body: {} });
    return data || { ok: false, error: 'Could not update permission.' };
  }

  async function lockAll(itemId) {
    const { data } = await api(`/api/items/${itemId}/lock`, { method: 'POST', body: {} });
    return data || { ok: false, error: 'Could not lock that file.' };
  }

  async function toggleVisibility(itemId) {
    const { data } = await api(`/api/items/${itemId}/toggle`, { method: 'POST', body: {} });
    return data || { ok: false, error: 'Could not update visibility.' };
  }

  async function deleteItem(itemId) {
    const { data } = await api(`/api/items/${itemId}`, { method: 'DELETE' });
    return data || { ok: false, error: 'Could not delete that file.' };
  }

  async function updateAvatar(file) {
    if (!file) return { ok: false, error: 'Choose a profile image.' };
    const fd = new FormData();
    fd.append('avatar', file);
    const { data } = await api('/api/avatar', { method: 'POST', body: fd });
    if (data && data.ok) {
      if (cachedUser) cachedUser.avatar = data.avatar || cachedUser.avatar;
      else await refreshMe();
    }
    return data || { ok: false, error: 'Choose a profile image.' };
  }

  async function updateAccount(payload) {
    const { data } = await api('/api/account', { method: 'POST', body: payload || {} });
    if (data && data.ok) await refreshMe();
    return data || { ok: false, error: 'Could not update account.' };
  }

  async function listAllUsers() {
    const { data } = await api('/api/admin/users');
    if (!data || !data.ok) return [];
    return data.users || [];
  }

  async function addUser(username, password, confirm) {
    const { data } = await api('/api/admin/users', {
      method: 'POST',
      body: { username, password, confirm },
    });
    return data || { ok: false, error: 'Could not create user.' };
  }

  async function deleteUser(userId) {
    const { data } = await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    return data || { ok: false, error: 'Could not delete user.' };
  }

  async function downloadFile(itemId, mode) {
    try {
      const res = await fetch(
        `/api/download?item_id=${encodeURIComponent(itemId)}&mode=${encodeURIComponent(mode || 'download')}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (res.status === 403) {
        return { ok: false, blob: null, filename: '', canPreview: false, title: '', error: 'locked' };
      }
      if (!res.ok) {
        return { ok: false, blob: null, filename: '', canPreview: false, title: '', error: 'notfound' };
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m ? decodeURIComponent(m[1]) : 'download';
      const canPreview = mode === 'view' && isPreviewable(blob.type);
      return { ok: true, blob, filename, canPreview, title: filename, error: null };
    } catch (_) {
      return { ok: false, blob: null, filename: '', canPreview: false, title: '', error: 'unavailable' };
    }
  }

  const SEStore = {
    root,
    cfg: CFG,
    init,
    register,
    login,
    logout,
    changeLocalPassword,
    renameLocalAccount,
    adminLoggedIn,
    getCurrentUser,
    readUserHint,
    getSessionUsername,
    isValidUsername,
    whenReady,
    searchUsers,
    listItemsForUser,
    checkAccess,
    requestAccess,
    verifyPasswordAccess,
    notificationsPayload,
    markNotifications,
    unreadSummary,
    revokeAccess,
    clearDone,
    uploadItem,
    getUploadConfig,
    listOwnerItems,
    togglePassword,
    lockAll,
    toggleVisibility,
    deleteItem,
    updateAvatar,
    updateAccount,
    listAllUsers,
    addUser,
    deleteUser,
    downloadFile,
    avatarUrl,
    formatBytes,
    isPreviewable,
  };

  global.SEStore = SEStore;
})(typeof window !== 'undefined' ? window : globalThis);
