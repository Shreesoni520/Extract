(() => {
  const list = document.getElementById('notifList');
  const bell = document.getElementById('notifBell');
  const unreadCount = document.getElementById('unreadCount');
  const markAll = document.getElementById('markAll');
  const clearDone = document.getElementById('clearDone');
  const ping = document.getElementById('ping');
  const liveToast = document.getElementById('liveToast');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileName = document.getElementById('fileName');
  const uploadForm = document.getElementById('uploadForm');
  const maxBytes = Number(uploadForm?.dataset?.maxBytes || 50 * 1024 * 1024);
  const maxLabel = uploadForm?.dataset?.maxLabel || '50 MB';
  const defaultFileHint = `or click to browse · max ${maxLabel}`;

  let lastId = 0;
  let known = new Set();
  let latestItems = [];
  let pollBusy = false;
  let watchBusy = false;
  let pollTimer = null;
  let watchTimer = null;
  let toastTimer = null;
  let lastFingerprint = '';
  const WATCH_MS = 500;   // same idea as live avatar updates — check often
  const FULL_POLL_MS = 4000; // occasional full sync for timers

  function setFileLabel(file) {
    if (!fileName || !dropzone) return;
    if (!file) {
      fileName.textContent = defaultFileHint;
      dropzone.classList.remove('has-file');
      return;
    }
    const mb = (file.size / (1024 * 1024)).toFixed(file.size > 1024 * 1024 ? 1 : 2);
    fileName.textContent = `${file.name} · ${mb} MB`;
    dropzone.classList.add('has-file');
  }

  function rejectIfTooLarge(file) {
    if (!file || file.size <= maxBytes) return false;
    alert(`File is too large (max ${maxLabel}). Pick a smaller file.`);
    if (fileInput) fileInput.value = '';
    setFileLabel(null);
    return true;
  }

  if (dropzone && fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0] || null;
      if (rejectIfTooLarge(file)) return;
      setFileLabel(file);
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-drag');
      });
    });

    ['dragleave', 'drop'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (rejectIfTooLarge(file)) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      setFileLabel(file);
    });
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', (e) => {
      const file = fileInput?.files?.[0];
      if (!file) return;
      if (file.size > maxBytes) {
        e.preventDefault();
        alert(`File is too large (max ${maxLabel}). Pick a smaller file.`);
      }
    });
  }

  function formatLeft(sec) {
    if (sec == null) return '';
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = String(s % 60).padStart(2, '0');
    return `${m}:${r}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function requesterBlock(n) {
    const r = n.requester || {};
    if (r.username) {
      return `
        <div class="notif-who">
          <img class="notif-avatar" src="${escapeHtml(r.avatar || '')}" alt="" width="44" height="44" loading="lazy" />
          <div class="notif-who-text">
            <strong class="notif-who-name">@${escapeHtml(r.username)}</strong>
            <span class="notif-who-action">wants access to this file</span>
          </div>
        </div>`;
    }
    return `
      <div class="notif-who notif-who--unknown">
        <span class="notif-avatar notif-avatar--placeholder" aria-hidden="true">?</span>
        <div class="notif-who-text">
          <strong class="notif-who-name">Unknown visitor</strong>
          <span class="notif-who-action">wants access to this file</span>
        </div>
      </div>`;
  }

  function statusPill(n) {
    if (n.is_done) {
      return `<span class="status-pill status-pill--done">${n.status === 'expired' ? 'Expired' : 'Used'}</span>`;
    }
    if (n.status === 'pending') {
      return '<span class="status-pill status-pill--pending">Needs password</span>';
    }
    if (n.status === 'unlocked') {
      return '<span class="status-pill status-pill--open">Unlocked</span>';
    }
    return '';
  }

  function timerText(n) {
    if (n.is_done) {
      return n.status === 'expired' ? 'Expired · Done' : 'Used · Done';
    }
    if (n.status === 'pending' && n.password_seconds_left != null) {
      return `Password expires in <strong class="notif-timer" data-kind="password" data-left="${n.password_seconds_left}">${formatLeft(n.password_seconds_left)}</strong>`;
    }
    if (n.status === 'unlocked' && n.unlock_seconds_left != null) {
      return `Unlocked · <strong class="notif-timer" data-kind="unlock" data-left="${n.unlock_seconds_left}">${formatLeft(n.unlock_seconds_left)}</strong> left`;
    }
    return `Status: ${escapeHtml(n.status)}`;
  }

  function bindActions() {
    list.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        } catch (_) {
          btn.textContent = 'Failed';
        }
      });
    });

    list.querySelectorAll('.lock-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const requestId = Number(btn.getAttribute('data-request') || 0);
        const itemId = Number(btn.getAttribute('data-item') || 0);
        if (!requestId && !itemId) return;
        btn.disabled = true;
        try {
          const res = await fetch('/Extract/api/revoke-access.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              request_id: requestId || undefined,
              item_id: itemId || undefined,
            }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Failed');
          poll();
        } catch (_) {
          btn.disabled = false;
        }
      });
    });

    list.querySelectorAll('.clear-one-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-id') || 0);
        if (!id) return;
        btn.disabled = true;
        try {
          const res = await fetch('/Extract/api/clear-done.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notification_id: id }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Failed');
          poll();
        } catch (_) {
          btn.disabled = false;
        }
      });
    });
  }

  function render(items, unread, doneCount) {
    latestItems = items;
    if (clearDone) {
      clearDone.disabled = doneCount < 1;
      clearDone.textContent = doneCount > 0 ? `Clear done (${doneCount})` : 'Clear done';
    }

    if (!items.length) {
      list.innerHTML = `
        <li class="notif-empty">
          <span class="notif-mark" aria-hidden="true">
            <span class="notif-mark__ring"></span>
            <span class="notif-mark__ring"></span>
            <span class="notif-mark__ring"></span>
            <span class="notif-mark__dot"></span>
          </span>
          <strong>Waiting for requests</strong>
          <p>When someone asks for a password, their name and code appear here right away.</p>
        </li>`;
      if (bell) bell.hidden = true;
      return;
    }

    if (unreadCount) unreadCount.textContent = String(unread);
    if (bell) bell.hidden = unread < 1;

    list.innerHTML = items.map((n) => {
      const fresh = !known.has(n.id);
      const done = Boolean(n.is_done);
      const lockBtn = n.can_lock
        ? `<button type="button" class="ghost small lock-btn" data-request="${n.request_id}" data-item="${n.item_id}">Lock again</button>`
        : '';
      const clearBtn = done
        ? `<button type="button" class="ghost small clear-one-btn" data-id="${n.id}">Clear</button>`
        : '';

      return `
        <li class="notif-item ${done ? 'is-done' : ''} ${n.is_read ? 'is-read' : 'unread'} ${fresh && !done ? 'fresh' : ''}" data-id="${n.id}">
          <div class="notif-top">
            ${requesterBlock(n)}
            ${statusPill(n)}
          </div>
          <div class="notif-body">
            <p class="notif-file">
              <span class="notif-file-label">File</span>
              <strong>${escapeHtml(n.item_title)}</strong>
            </p>
            <p class="notif-meta">${timerText(n)}</p>
          </div>
          <div class="notif-actions">
            ${done ? '' : `
            <div class="password-chip">
              <span class="password-chip-label">Password</span>
              <span class="password-chip-code">${escapeHtml(n.password)}</span>
              <button type="button" class="copy-btn" data-copy="${escapeHtml(n.password)}">Copy</button>
            </div>`}
            ${lockBtn}
            ${clearBtn}
          </div>
        </li>
      `;
    }).join('');

    bindActions();
    items.forEach((n) => known.add(n.id));
  }

  function tickTimers() {
    list?.querySelectorAll('.notif-timer').forEach((el) => {
      let left = Number(el.getAttribute('data-left') || 0) - 1;
      if (left < 0) left = 0;
      el.setAttribute('data-left', String(left));
      el.textContent = formatLeft(left);
    });

    latestItems.forEach((n) => {
      if (n.password_seconds_left != null && n.password_seconds_left > 0) {
        n.password_seconds_left -= 1;
      }
      if (n.unlock_seconds_left != null && n.unlock_seconds_left > 0) {
        n.unlock_seconds_left -= 1;
      }
    });
  }

  function showLiveToast(item) {
    if (!liveToast || !item) return;
    const who = item.requester?.username ? `@${item.requester.username}` : 'Someone';
    const file = item.item_title || 'a file';
    liveToast.hidden = false;
    liveToast.innerHTML = `<strong>${escapeHtml(who)}</strong> requested access to <em>${escapeHtml(file)}</em>`;
    liveToast.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      liveToast.classList.remove('is-on');
      liveToast.hidden = true;
    }, 4500);
  }

  async function applyPayload(data) {
    if (!data || !data.ok || !list) return;

    const items = data.notifications || [];
    const maxId = items.reduce((m, n) => Math.max(m, n.id || 0), 0);
    const newOnes = lastId > 0
      ? items.filter((n) => n.id > lastId && !n.is_done)
      : [];

    if (newOnes.length) {
      showLiveToast(newOnes[0]);
      try {
        if (ping) {
          ping.currentTime = 0;
          await ping.play();
        }
      } catch (_) {}
    }

    if (maxId) lastId = Math.max(lastId, maxId);
    render(items, data.unread, data.done_count || 0);
  }

  async function poll() {
    if (pollBusy || !list) return;
    pollBusy = true;
    try {
      const res = await fetch(`/Extract/api/notifications.php?since_id=0&_=${Date.now()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      await applyPayload(data);
    } catch (_) {
      // keep trying
    } finally {
      pollBusy = false;
    }
  }

  async function watch() {
    if (watchBusy || !list || document.visibilityState !== 'visible') return;
    watchBusy = true;
    try {
      const res = await fetch(`/Extract/api/unread.php?_=${Date.now()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      const fp = data.fingerprint || '';
      if (!lastFingerprint) {
        lastFingerprint = fp;
        return;
      }
      if (fp && fp !== lastFingerprint) {
        lastFingerprint = fp;
        await poll();
      }
    } catch (_) {
      // ignore
    } finally {
      watchBusy = false;
    }
  }

  window.SE_refreshNotifications = async function refreshNotifications() {
    lastFingerprint = '';
    await poll();
    await watch();
  };

  function schedulePoll() {
    if (pollTimer) clearInterval(pollTimer);
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(watch, WATCH_MS);
    pollTimer = setInterval(poll, FULL_POLL_MS);
  }

  clearDone?.addEventListener('click', async () => {
    clearDone.disabled = true;
    const original = clearDone.textContent;
    clearDone.textContent = 'Clearing…';
    try {
      const res = await fetch('/Extract/api/clear-done.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      await poll();
      clearDone.textContent = 'Cleared';
      setTimeout(() => {
        clearDone.textContent = 'Clear done';
      }, 1200);
    } catch (_) {
      clearDone.textContent = 'Try again';
      setTimeout(() => {
        clearDone.textContent = original;
        clearDone.disabled = false;
      }, 1200);
    }
  });

  markAll?.addEventListener('click', async () => {
    markAll.disabled = true;
    markAll.classList.remove('is-done');
    const original = markAll.textContent;
    markAll.textContent = 'Marking…';
    try {
      const res = await fetch('/Extract/api/mark-notifications.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      await poll();
      markAll.textContent = 'All read';
      markAll.classList.add('is-done');
      setTimeout(() => {
        markAll.textContent = original;
        markAll.classList.remove('is-done');
        markAll.disabled = false;
      }, 1400);
    } catch (_) {
      markAll.textContent = 'Try again';
      setTimeout(() => {
        markAll.textContent = original;
        markAll.disabled = false;
      }, 1400);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });

  window.addEventListener('focus', () => poll());

  poll();
  schedulePoll();
  setInterval(tickTimers, 1000);

  if (window.location.hash === '#access-requests') {
    setTimeout(() => {
      document.getElementById('access-requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }

  function canPreview(mime) {
    return (mime || '').startsWith('image/')
      || (mime || '').startsWith('video/')
      || (mime || '').startsWith('audio/')
      || mime === 'application/pdf'
      || (mime || '').startsWith('text/');
  }

  function openFileShareUrl(itemId, mime) {
    const mode = canPreview(mime) ? 'view' : 'download';
    return `${window.location.origin}/Extract/api/download.php?item_id=${itemId}&mode=${mode}`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (_) {
        return false;
      }
    }
  }

  document.querySelectorAll('.js-copy-link').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-item-id');
      const mime = btn.getAttribute('data-mime') || '';
      if (!id) return;
      const original = btn.dataset.label || btn.textContent;
      btn.dataset.label = original;
      const ok = await copyText(openFileShareUrl(id, mime));
      btn.textContent = ok ? 'Copied!' : 'Could not copy';
      setTimeout(() => {
        btn.textContent = original;
      }, 2200);
    });
  });

  // Your files — 4 per page, Instagram-style swipe
  const ownerTrack = document.getElementById('ownerTrack');
  const ownerPrev = document.getElementById('ownerPrev');
  const ownerNext = document.getElementById('ownerNext');
  const ownerDots = document.getElementById('ownerDots');
  const ownerHint = document.getElementById('ownerFileHint');
  const ownerViewport = document.getElementById('ownerViewport');
  const ownerPager = document.getElementById('ownerPager');
  let ownerPage = 0;
  const ownerPages = Math.max(1, Number(ownerPager?.getAttribute('data-pages') || 1));

  function syncOwnerPager() {
    if (!ownerTrack?.classList.contains('is-paged')) return;
    ownerTrack.style.transform = `translate3d(-${ownerPage * 100}%, 0, 0)`;
    if (ownerPrev) ownerPrev.disabled = ownerPage <= 0;
    if (ownerNext) ownerNext.disabled = ownerPage >= ownerPages - 1;
    ownerDots?.querySelectorAll('.owner-dot').forEach((dot) => {
      const p = Number(dot.getAttribute('data-page') || 0);
      dot.classList.toggle('is-active', p === ownerPage);
    });
    if (ownerHint) {
      ownerHint.hidden = false;
      ownerHint.textContent = `Page ${ownerPage + 1} of ${ownerPages} · 4 per page`;
    }
  }

  function goOwnerPage(page) {
    if (!ownerTrack?.classList.contains('is-paged')) return;
    ownerPage = Math.max(0, Math.min(ownerPages - 1, page));
    syncOwnerPager();
  }

  if (ownerTrack?.classList.contains('is-paged')) {
    syncOwnerPager();
    ownerPrev?.addEventListener('click', () => goOwnerPage(ownerPage - 1));
    ownerNext?.addEventListener('click', () => goOwnerPage(ownerPage + 1));
    ownerDots?.querySelectorAll('.owner-dot').forEach((dot) => {
      dot.addEventListener('click', () => goOwnerPage(Number(dot.getAttribute('data-page') || 0)));
    });

    let touchX = null;
    ownerViewport?.addEventListener('touchstart', (e) => {
      touchX = e.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    ownerViewport?.addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const x = e.changedTouches[0]?.clientX ?? touchX;
      const dx = x - touchX;
      touchX = null;
      if (Math.abs(dx) < 45) return;
      goOwnerPage(ownerPage + (dx < 0 ? 1 : -1));
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') goOwnerPage(ownerPage - 1);
      if (e.key === 'ArrowRight') goOwnerPage(ownerPage + 1);
    });
  }
})();
