(function (global) {
  'use strict';

  const CFG = {
    passwordTtlSeconds: 300,
    unlockTtlSeconds: 300,
    maxUploadBytes: 1024 * 1024 * 1024,
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

  const SESSION_KEY = 'se_session_v1';
  const CLEAN_FLAG = 'se_fresh_v2';

  function wipeStaleBrowserAuth() {
    try {
      if (global.localStorage.getItem(CLEAN_FLAG)) return;
      global.localStorage.removeItem(SESSION_KEY);
      global.localStorage.removeItem('se_users_v1');
      global.localStorage.removeItem('se_user_hint');
      global.sessionStorage.removeItem('se_user_hint');
      global.localStorage.setItem(CLEAN_FLAG, '1');
    } catch (_) {}
  }

  function isValidUsername(username) {
    return /^[a-zA-Z0-9._]{3,20}$/.test(String(username || '').trim());
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

  function adminLoggedIn() {
    return !!(cachedUser && cachedUser.username);
  }

  function readUserHint() {
    if (cachedUser && cachedUser.username) {
      return { id: cachedUser.id || 0, username: cachedUser.username };
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

  function applyServerUser(user) {
    if (!user || !user.username) {
      cachedUser = null;
      setSessionUsername(null);
      writeUserHint(null);
      return null;
    }
    cachedUser = {
      id: Number(user.id) || 0,
      username: String(user.username),
      avatar: user.avatar || null,
    };
    setSessionUsername(cachedUser.username);
    writeUserHint(cachedUser);
    return cachedUser;
  }

  async function refreshMe() {
    try {
      const { data } = await api('/api/auth/me');
      if (data && data.ok && data.user && data.user.username) {
        applyServerUser(data.user);
        try {
          global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
        } catch (_) {}
        return cachedUser;
      }
      if (data && data.ok) {
        applyServerUser(null);
        try {
          global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: null }));
        } catch (_) {}
        return null;
      }
    } catch (_) {}
    return cachedUser;
  }

  async function init(opts) {
    wipeStaleBrowserAuth();
    const force = !!(opts && opts.force);
    if (force) {
      ready = null;
      cachedUser = null;
    }
    if (!ready) {
      ready = refreshMe();
    }
    try {
      await ready;
    } catch (_) {}
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
    const { data } = await api('/api/auth/register', {
      method: 'POST',
      body: { username: trimmed, password, confirm },
    });
    if (!data || !data.ok) {
      return data || { ok: false, error: 'Could not continue' };
    }
    applyServerUser(data.user);
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
    } catch (_) {}
    return { ok: true, user: cachedUser };
  }

  async function login(username, password) {
    const trimmed = String(username || '').trim();
    if (!isValidUsername(trimmed)) {
      return { ok: false, error: 'Username must be 3-20 letters, numbers, dots, or underscores.' };
    }
    if (!password) return { ok: false, error: 'Enter your password.' };
    const { data } = await api('/api/auth/login', {
      method: 'POST',
      body: { username: trimmed, password },
    });
    if (!data || !data.ok) {
      return data || { ok: false, error: 'Could not continue' };
    }
    applyServerUser(data.user);
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: cachedUser }));
    } catch (_) {}
    return { ok: true, user: cachedUser };
  }

  async function logout() {
    cachedUser = null;
    writeUserHint(null);
    setSessionUsername(null);
    ready = null;
    try { sessionStorage.removeItem('se_user_hint'); } catch (_) {}
    try { global.localStorage.removeItem('se_users_v1'); } catch (_) {}
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        body: {},
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (_) {}
    applyServerUser(null);
    try {
      global.dispatchEvent(new CustomEvent('se-auth-updated', { detail: null }));
    } catch (_) {}
  }

  async function renameLocalAccount(newUsername) {
    if (!cachedUser) return { ok: false, error: 'Not logged in.' };
    const trimmed = String(newUsername || '').trim();
    if (!isValidUsername(trimmed)) {
      return { ok: false, error: 'Username must be 3-20 letters, numbers, dots, or underscores.' };
    }
    applyServerUser(Object.assign({}, cachedUser, { username: trimmed }));
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
      await refreshMe();
    }
    return data || { ok: false, error: 'Choose a profile image.' };
  }

  async function updateAccount(payload) {
    const { data } = await api('/api/account', { method: 'POST', body: payload || {} });
    if (data && data.ok) {
      await refreshMe();
    }
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
    const url = `/api/download?item_id=${encodeURIComponent(itemId)}&mode=${encodeURIComponent(mode || 'download')}`;
    const empty = {
      ok: false, blob: null, filename: '', canPreview: false, title: '', error: 'unavailable',
    };
    try {
      const firstEnd = 700000 - 1;
      const first = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Range: `bytes=0-${firstEnd}` },
      });
      if (first.status === 403) return Object.assign({}, empty, { error: 'locked' });
      if (first.status === 404) return Object.assign({}, empty, { error: 'notfound' });
      if (!first.ok && first.status !== 206) return empty;

      const name = filenameFromDisposition(first.headers.get('Content-Disposition')) || 'download';
      const type = first.headers.get('Content-Type') || 'application/octet-stream';

      if (first.status === 200) {
        const blob = await first.blob();
        return {
          ok: true,
          blob,
          filename: name,
          canPreview: mode === 'view' && isPreviewable(blob.type || type),
          title: name,
          error: null,
        };
      }

      const totalMatch = /\/(\d+)\s*$/.exec(first.headers.get('Content-Range') || '');
      const total = totalMatch ? Number(totalMatch[1]) : 0;
      const parts = [await first.blob()];
      const chunk = 700000;
      if (total > chunk) {
        for (let start = chunk; start < total; start += chunk) {
          const end = Math.min(total - 1, start + chunk - 1);
          const part = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            headers: { Range: `bytes=${start}-${end}` },
          });
          if (part.status === 403) return Object.assign({}, empty, { error: 'locked' });
          if (!part.ok && part.status !== 206) return empty;
          parts.push(await part.blob());
          if (typeof global.dispatchEvent === 'function') {
            try {
              global.dispatchEvent(new CustomEvent('se-download-progress', {
                detail: { itemId, loaded: Math.min(end + 1, total), total },
              }));
            } catch (_) {}
          }
        }
      }
      const blob = new Blob(parts, { type: parts[0].type || type });
      return {
        ok: true,
        blob,
        filename: name,
        canPreview: mode === 'view' && isPreviewable(blob.type || type),
        title: name,
        error: null,
      };
    } catch (_) {
      return empty;
    }
  }

  function filenameFromDisposition(cd) {
    if (!cd) return 'download';
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    if (star) {
      try { return decodeURIComponent(star[1]); } catch (_) { return star[1]; }
    }
    const m = /filename="?([^";]+)"?/i.exec(cd);
    if (!m) return 'download';
    try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
  }

  const SEStore = {
    root,
    cfg: CFG,
    init,
    register,
    login,
    logout,
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
