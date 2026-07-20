(() => {
  if (!window.SE_LOGGED_IN) return;

  const grid = document.getElementById('grid');
  const userGrid = document.getElementById('userGrid');
  const profileBanner = document.getElementById('profileBanner');
  const sectionTitle = document.getElementById('sectionTitle');
  const sectionText = document.getElementById('sectionText');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalText = document.getElementById('modalText');
  const modalMeta = document.getElementById('modalMeta');
  const modalKicker = document.getElementById('modalKicker');
  const modalClose = document.getElementById('modalClose');
  const requestBtn = document.getElementById('requestBtn');
  const passForm = document.getElementById('passForm');
  const passInput = document.getElementById('passInput');
  const timerWrap = document.getElementById('timerWrap');
  const timerBar = document.getElementById('timerBar');
  const timerLabel = document.getElementById('timerLabel');
  const unlockedActions = document.getElementById('unlockedActions');
  const viewBtn = document.getElementById('viewBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const copyLinkHint = document.getElementById('copyLinkHint');
  const modalError = document.getElementById('modalError');
  const browseBtn = document.getElementById('browseBtn');
  const backBtn = document.getElementById('backBtn');
  const landing = document.getElementById('landing');
  const filesView = document.getElementById('filesView');
  const veil = document.getElementById('pageVeil');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');
  const searchMeta = document.getElementById('searchMeta');
  const fileListHead = document.getElementById('fileListHead');
  const fileListHint = document.getElementById('fileListHint');
  const filePrev = document.getElementById('filePrev');
  const fileNext = document.getElementById('fileNext');
  const fileDots = document.getElementById('fileDots');
  const fileViewport = document.getElementById('fileViewport');

  let current = null;
  let timerId = null;
  let timerTotal = 0;
  let timerLeft = 0;
  let timerMode = 'password';
  let cache = [];
  let userCache = [];
  let selectedUser = null;
  let currentQuery = '';
  let transitioning = false;
  let searchTimer = null;
  let listPage = 0;
  const FILE_PAGE_SIZE = 4;
  const MIN_SEARCH_LEN = 2;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function blackWipeCover() {
    if (!veil) return;
    veil.classList.remove('reveal');
    veil.classList.add('cover');
    await wait(560);
  }

  async function blackWipeReveal() {
    if (!veil) return;
    veil.classList.remove('cover');
    veil.classList.add('reveal');
    await wait(560);
    veil.classList.remove('reveal');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = String(Math.max(0, sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }

  function canPreview(mime) {
    return mime.startsWith('image/')
      || mime.startsWith('video/')
      || mime.startsWith('audio/')
      || mime === 'application/pdf'
      || mime.startsWith('text/');
  }

  function setSearchMode() {
    selectedUser = null;
    listPage = 0;
    document.querySelector('.files')?.classList.remove('is-profile');
    if (sectionTitle) sectionTitle.textContent = 'Find people';
    if (sectionText) sectionText.textContent = 'Search by username to find someone. Results appear after you type at least 2 characters.';
    if (profileBanner) {
      profileBanner.classList.remove('is-in');
      profileBanner.hidden = true;
      profileBanner.innerHTML = '';
    }
    if (fileListHead) fileListHead.hidden = true;
    hideFilePager();
    if (searchForm) searchForm.hidden = false;
    if (userGrid) {
      userGrid.hidden = false;
      userGrid.classList.remove('is-leaving');
    }
  }

  function paintProfileBanner(user) {
    if (!profileBanner) return;
    const count = user.file_count ?? 0;
    profileBanner.hidden = false;
    profileBanner.classList.remove('is-out');
    profileBanner.innerHTML = `
      <img src="${escapeHtml(user.avatar)}" alt="" />
      <div class="profile-banner-copy">
        <h3>${escapeHtml(user.username)}</h3>
        <p>Their uploads · ready when you are</p>
      </div>
      <span class="profile-count">${count} file${count === 1 ? '' : 's'}</span>
    `;
    profileBanner.classList.remove('is-in');
    void profileBanner.offsetWidth;
    profileBanner.classList.add('is-in');
  }

  function setUserMode(user) {
    selectedUser = user;
    listPage = 0;
    document.querySelector('.files')?.classList.add('is-profile');
    if (sectionTitle) sectionTitle.textContent = 'Files';
    if (sectionText) {
      sectionText.textContent = 'Tap a file to open it. Locked ones need a password — open ones are ready right away.';
    }
    paintProfileBanner(user);
    if (fileListHead) fileListHead.hidden = false;
    if (fileListHint) fileListHint.textContent = 'Tap a file to open it';
    if (searchForm) searchForm.hidden = true;
    if (searchMeta) searchMeta.hidden = true;
    if (userGrid) {
      userGrid.innerHTML = '';
      userGrid.hidden = true;
    }
  }

  function pageCount() {
    return Math.max(1, Math.ceil(cache.length / FILE_PAGE_SIZE));
  }

  function hideFilePager() {
    if (filePrev) filePrev.hidden = true;
    if (fileNext) fileNext.hidden = true;
    if (fileDots) {
      fileDots.hidden = true;
      fileDots.innerHTML = '';
    }
    grid?.classList.remove('is-paged');
    if (grid) grid.style.transform = '';
  }

  function bindFileRows(root) {
    (root || grid)?.querySelectorAll('.row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = cache.find((x) => String(x.id) === btn.getAttribute('data-id'));
        if (item) openModal(item);
      });
    });
  }

  function syncFilePagerChrome() {
    const pages = pageCount();
    const multi = cache.length > FILE_PAGE_SIZE;
    if (filePrev) {
      filePrev.hidden = !multi;
      filePrev.disabled = listPage <= 0;
    }
    if (fileNext) {
      fileNext.hidden = !multi;
      fileNext.disabled = listPage >= pages - 1;
    }
    if (fileDots) {
      if (!multi) {
        fileDots.hidden = true;
        fileDots.innerHTML = '';
      } else {
        fileDots.hidden = false;
        const existing = fileDots.querySelectorAll('.file-dot');
        if (existing.length !== pages) {
          fileDots.innerHTML = Array.from({ length: pages }, (_, i) => (
            `<button type="button" class="file-dot${i === listPage ? ' is-active' : ''}" data-page="${i}" aria-label="Page ${i + 1} of ${pages}"></button>`
          )).join('');
          fileDots.querySelectorAll('.file-dot').forEach((dot) => {
            dot.addEventListener('click', () => goToFilePage(Number(dot.getAttribute('data-page') || 0)));
          });
        } else {
          existing.forEach((dot) => {
            const p = Number(dot.getAttribute('data-page') || 0);
            dot.classList.toggle('is-active', p === listPage);
          });
        }
      }
    }
    if (fileListHint) {
      if (!cache.length) {
        fileListHint.textContent = 'Tap a file to open it';
      } else if (multi) {
        fileListHint.textContent = `Page ${listPage + 1} of ${pages} · ${FILE_PAGE_SIZE} per page`;
      } else {
        fileListHint.textContent = 'Tap a file to open it';
      }
    }
  }

  function renderFilePages({ animate = false } = {}) {
    if (!grid) return;
    if (!cache.length) {
      hideFilePager();
      grid.classList.remove('is-paged', 'is-entering');
      grid.style.transform = '';
      grid.innerHTML = '<div class="muted">No files from this person yet.</div>';
      return;
    }

    const pages = pageCount();
    if (listPage >= pages) listPage = pages - 1;
    if (listPage < 0) listPage = 0;

    if (animate) {
      grid.classList.remove('is-entering');
      void grid.offsetWidth;
      grid.classList.add('is-entering');
    } else {
      grid.classList.remove('is-entering');
    }

    // One page: normal stacked list (no carousel chrome)
    if (pages <= 1) {
      hideFilePager();
      grid.classList.remove('is-paged');
      grid.style.transform = '';
      grid.innerHTML = cache.map((item, i) => rowHtml(item, i)).join('');
      bindFileRows(grid);
      if (fileListHint) fileListHint.textContent = 'Tap a file to open it';
      return;
    }

    const chunks = [];
    for (let i = 0; i < cache.length; i += FILE_PAGE_SIZE) {
      chunks.push(cache.slice(i, i + FILE_PAGE_SIZE));
    }

    grid.classList.add('is-paged');
    grid.innerHTML = chunks.map((chunk, pageIdx) => `
      <div class="file-page" data-page="${pageIdx}">
        ${chunk.map((item, i) => rowHtml(item, i)).join('')}
      </div>
    `).join('');

    grid.style.transform = `translate3d(-${listPage * 100}%, 0, 0)`;
    bindFileRows(grid);
    syncFilePagerChrome();
  }

  function goToFilePage(page) {
    const pages = pageCount();
    if (pages < 1) return;
    listPage = Math.max(0, Math.min(pages - 1, page));
    if (grid?.classList.contains('is-paged')) {
      grid.style.transform = `translate3d(-${listPage * 100}%, 0, 0)`;
    }
    syncFilePagerChrome();
  }

  async function goToFiles({ animate = true } = {}) {
    if (transitioning || !filesView) return;
    transitioning = true;
    if (browseBtn) browseBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;

    if (animate && veil) {
      await blackWipeCover();
    }

    if (landing) {
      landing.hidden = true;
      landing.style.display = 'none';
    }
    filesView.hidden = false;
    filesView.style.display = '';
    document.body.classList.remove('view-landing');
    document.body.classList.add('view-files');
    window.scrollTo(0, 0);
    sessionStorage.setItem('se_files_open', '1');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '/Extract/?browse=1');
    }
    setSearchMode();
    if (searchInput) searchInput.value = '';
    await searchUsers('');

    if (animate && veil) {
      await blackWipeReveal();
    }

    if (browseBtn) browseBtn.disabled = false;
    if (backBtn) backBtn.disabled = false;
    transitioning = false;
    searchInput?.focus();
  }

  async function goToHome({ animate = true } = {}) {
    if (transitioning) return;
    transitioning = true;
    if (browseBtn) browseBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;

    if (animate && veil) {
      await blackWipeCover();
    }

    if (filesView) {
      filesView.hidden = true;
      filesView.style.display = 'none';
    }
    if (landing) {
      landing.hidden = false;
      landing.style.display = '';
    }
    document.body.classList.remove('view-files');
    document.body.classList.add('view-landing');
    window.scrollTo(0, 0);
    sessionStorage.removeItem('se_files_open');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '/Extract/');
    }
    selectedUser = null;
    currentQuery = '';
    if (searchInput) searchInput.value = '';

    if (animate && veil) {
      await blackWipeReveal();
    }

    if (browseBtn) browseBtn.disabled = false;
    if (backBtn) backBtn.disabled = false;
    transitioning = false;
  }

  browseBtn?.addEventListener('click', () => goToFiles({ animate: true }));
  backBtn?.addEventListener('click', async () => {
    if (selectedUser) {
      if (openingUser) return;
      openingUser = true;
      try {
        await blackWipeCover();
        setSearchMode();
        if (searchInput) searchInput.value = '';
        if (grid) {
          grid.classList.remove('is-entering');
          grid.innerHTML = '<div class="muted">Loading people…</div>';
        }
        await searchUsers('');
        window.scrollTo(0, 0);
        await blackWipeReveal();
      } finally {
        openingUser = false;
      }
      return;
    }
    goToHome({ animate: true });
  });

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimer(seconds, mode, totalHint) {
    const nextLeft = Math.max(0, seconds | 0);
    const nextTotal = totalHint || nextLeft || 1;

    // Same mode already running — sync time quietly (no restart / flicker)
    if (timerId && timerMode === mode) {
      timerLeft = nextLeft;
      if (nextTotal > timerTotal) timerTotal = nextTotal;
      timerLabel.textContent = `${fmt(timerLeft)} ${timerMode === 'password' ? 'to enter password' : 'left to access'}`;
      const pct = Math.max(0, Math.min(100, (timerLeft / timerTotal) * 100));
      timerBar.style.width = `${pct}%`;
      timerBar.style.transform = 'none';
      return;
    }

    stopTimer();
    timerMode = mode;
    timerLeft = nextLeft;
    timerTotal = nextTotal;
    timerWrap.hidden = false;

    const paint = () => {
      timerLabel.textContent = `${fmt(Math.max(0, timerLeft))} ${timerMode === 'password' ? 'to enter password' : 'left to access'}`;
      const pct = Math.max(0, Math.min(100, (Math.max(0, timerLeft) / timerTotal) * 100));
      timerBar.style.width = `${pct}%`;
      timerBar.style.transform = 'none';
      if (timerLeft <= 0) {
        stopTimer();
        if (current) {
          current.access = { status: 'locked' };
          paintModal();
          if (selectedUser) loadUserFiles(selectedUser.id);
        }
        return;
      }
      timerLeft -= 1;
    };

    paint();
    timerId = setInterval(paint, 1000);
  }

  function showError(msg) {
    modalError.hidden = !msg;
    modalError.textContent = msg || '';
  }

  function setFileLinks(item) {
    if (!viewBtn || !downloadBtn) return;
    const base = `/Extract/api/download.php?item_id=${item.id}`;
    viewBtn.href = `${base}&mode=view`;
    downloadBtn.href = `${base}&mode=download`;
    viewBtn.style.display = canPreview(item.mime_type || '') ? '' : 'none';
    viewBtn.removeAttribute('aria-disabled');
    downloadBtn.removeAttribute('aria-disabled');
  }

  function clearFileLinks() {
    if (!viewBtn || !downloadBtn) return;
    viewBtn.removeAttribute('href');
    downloadBtn.removeAttribute('href');
    viewBtn.setAttribute('aria-disabled', 'true');
    downloadBtn.setAttribute('aria-disabled', 'true');
  }

  async function refreshAccessStatus() {
    if (!current?.id) return null;
    try {
      const res = await fetch(`/Extract/api/check-access.php?item_id=${encodeURIComponent(current.id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.href = '/Extract/app/login.php';
        return null;
      }
      const data = await res.json();
      if (!data.ok) return null;

      const prevStatus = current.access?.status;
      current.access = {
        status: data.status,
        request_id: data.request_id,
        seconds_left: data.seconds_left,
        can_preview: data.can_preview,
      };

      const cached = cache.find((x) => x.id === current.id);
      if (cached) cached.access = current.access;
      const badgeBtn = grid?.querySelector(`.row[data-id="${current.id}"] .badge`);
      if (badgeBtn) {
        const badge = accessLabel(current);
        badgeBtn.className = `badge ${badge.cls}`;
        badgeBtn.textContent = badge.text;
      }

      if (prevStatus && prevStatus !== data.status && accessRank(prevStatus) > accessRank(data.status)) {
        showError('This file was just locked. Request access again if you still need it.');
      }
      if (prevStatus !== data.status) {
        paintModal();
      } else if (
        (data.status === 'pending' || data.status === 'unlocked')
        && data.seconds_left != null
      ) {
        startTimer(
          data.seconds_left,
          data.status === 'pending' ? 'password' : 'unlock',
          300
        );
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  async function openFileIfAllowed(mode) {
    if (!current) return;
    const data = await refreshAccessStatus();
    const status = data?.status || current.access?.status;
    if (status !== 'unlocked' && status !== 'open') {
      showError('This file was just locked. Request access again if you still need it.');
      return;
    }
    const url = `/Extract/api/download.php?item_id=${current.id}&mode=${mode}`;
    if (mode === 'view') {
      window.open(url, '_blank', 'noopener');
    } else {
      window.location.href = url;
    }
  }

  function openFileShareUrl(item) {
    const base = `${window.location.origin}/Extract/api/download.php?item_id=${item.id}`;
    const mode = canPreview(item.mime_type || '') ? 'view' : 'download';
    return `${base}&mode=${mode}`;
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

  let copyLinkTimer = null;

  async function flashCopyButton(btn, ok) {
    if (!btn) return;
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = ok ? 'Copied!' : 'Could not copy';
    btn.classList.toggle('is-copied', ok);
    if (copyLinkTimer) clearTimeout(copyLinkTimer);
    copyLinkTimer = setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('is-copied');
    }, 2200);
  }

  function paintModal() {
    if (!current) return;
    const access = current.access || { status: 'locked' };
    modalTitle.textContent = current.title;
    if (modalMeta) {
      modalMeta.hidden = false;
      modalMeta.textContent = `${current.original_name} · ${current.file_size}`;
    }
    modal?.querySelector('.sheet')?.setAttribute('data-status', access.status);
    showError('');

    if (access.status === 'open') {
      modalKicker.textContent = 'Open';
      modalText.textContent = 'This file is ready. View it, download it, or copy a share link.';
      requestBtn.hidden = true;
      passForm.hidden = true;
      unlockedActions.hidden = false;
      if (copyLinkBtn) copyLinkBtn.hidden = false;
      if (copyLinkHint) copyLinkHint.hidden = false;
      timerWrap.hidden = true;
      stopTimer();
      setFileLinks(current);
    } else if (access.status === 'locked' || access.status === 'missing') {
      modalKicker.textContent = 'Locked';
      modalText.textContent = 'Request a one-time password. You will have 5 minutes to enter it once it is sent.';
      requestBtn.hidden = false;
      requestBtn.textContent = 'Request password';
      passForm.hidden = true;
      unlockedActions.hidden = true;
      if (copyLinkBtn) copyLinkBtn.hidden = true;
      if (copyLinkHint) copyLinkHint.hidden = true;
      timerWrap.hidden = true;
      stopTimer();
      clearFileLinks();
    } else if (access.status === 'pending') {
      modalKicker.textContent = 'Waiting';
      modalText.textContent = 'Request sent. Enter the password as soon as you get it — the clock is running.';
      requestBtn.hidden = true;
      passForm.hidden = false;
      unlockedActions.hidden = true;
      if (copyLinkBtn) copyLinkBtn.hidden = true;
      if (copyLinkHint) copyLinkHint.hidden = true;
      clearFileLinks();
      startTimer(access.seconds_left || 0, 'password', 300);
    } else {
      modalKicker.textContent = 'Unlocked';
      modalText.textContent = 'You are in. View or download before your session ends.';
      requestBtn.hidden = true;
      passForm.hidden = true;
      unlockedActions.hidden = false;
      if (copyLinkBtn) copyLinkBtn.hidden = true;
      if (copyLinkHint) copyLinkHint.hidden = true;
      setFileLinks(current);
      startTimer(access.seconds_left || 0, 'unlock', 300);
    }
  }

  function openModal(item) {
    current = item;
    modal.hidden = false;
    const sheet = modal.querySelector('.sheet');
    if (sheet) {
      sheet.classList.remove('is-enter');
      void sheet.offsetWidth;
      sheet.classList.add('is-enter');
    }
    paintModal();
    if (item.access?.status === 'pending') {
      passInput?.focus();
    }
  }

  function closeModal() {
    modal.hidden = true;
    current = null;
    stopTimer();
    passInput.value = '';
    showError('');
  }

  modalClose?.addEventListener('click', closeModal);
  viewBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openFileIfAllowed('view');
  });
  downloadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openFileIfAllowed('download');
  });
  copyLinkBtn?.addEventListener('click', async () => {
    if (!current) return;
    const ok = await copyText(openFileShareUrl(current));
    await flashCopyButton(copyLinkBtn, ok);
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  requestBtn?.addEventListener('click', async () => {
    if (!current) return;
    requestBtn.disabled = true;
    showError('');
    try {
      const res = await fetch('/Extract/api/request-access.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ item_id: current.id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Request failed');
      current.access = {
        status: data.status,
        request_id: data.request_id,
        seconds_left: data.seconds_left,
      };
      paintModal();
      if (selectedUser) loadUserFiles(selectedUser.id);
    } catch (err) {
      showError(err.message || 'Could not request access');
    } finally {
      requestBtn.disabled = false;
    }
  });

  passForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    showError('');
    try {
      const res = await fetch('/Extract/api/verify-password.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          item_id: current.id,
          password: passInput.value.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Unlock failed');
      current.access = {
        status: 'unlocked',
        request_id: data.request_id,
        seconds_left: data.seconds_left,
      };
      passInput.value = '';
      paintModal();
      if (selectedUser) loadUserFiles(selectedUser.id);
    } catch (err) {
      showError(err.message || 'Wrong password');
    }
  });

  function accessLabel(item) {
    const status = item.access?.status;
    if (status === 'open') return { text: 'Open', cls: 'open' };
    if (status === 'unlocked') return { text: 'Unlocked', cls: 'unlocked' };
    if (status === 'pending') return { text: 'Waiting', cls: 'pending' };
    return { text: 'Locked', cls: 'locked' };
  }

  function rowHtml(item, i) {
    const badge = accessLabel(item);
    const delay = typeof i === 'number' ? ` style="animation-delay:${i * 0.04}s"` : '';
    return `
      <button class="row" type="button" data-id="${item.id}"${delay}>
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.original_name)} · ${escapeHtml(item.file_size)}</p>
        </div>
        <span class="badge ${badge.cls}">${badge.text}</span>
      </button>
    `;
  }

  function userCardHtml(user, i) {
    const count = user.file_count;
    return `
      <button class="user-card" type="button" data-user-id="${user.id}" style="animation-delay:${Math.min(i, 12) * 0.04}s">
        <img src="${escapeHtml(user.avatar)}" alt="" />
        <div>
          <strong>${escapeHtml(user.username)}</strong>
          <span>${count} file${count === 1 ? '' : 's'}</span>
        </div>
      </button>
    `;
  }

  function renderUsers(users, query, meta) {
    userCache = users;
    const q = (query || '').trim();
    const tooShort = q.length > 0 && q.length < MIN_SEARCH_LEN;
    const matchedSelf = !!(meta && meta.matched_self);

    if (searchMeta) {
      searchMeta.hidden = false;
      if (!q) {
        searchMeta.textContent = 'Search by username. Type at least 2 characters to see people.';
      } else if (tooShort) {
        searchMeta.textContent = `Type ${MIN_SEARCH_LEN - q.length} more character${MIN_SEARCH_LEN - q.length === 1 ? '' : 's'} to search.`;
      } else if (users.length) {
        searchMeta.textContent = `Found ${users.length} person(s) for “${q}”`;
      } else if (matchedSelf) {
        searchMeta.textContent = `“${q}” is you — search for someone else’s username.`;
      } else {
        searchMeta.textContent = `No users found for “${q}”`;
      }
    }
    if (clearSearch) clearSearch.hidden = !q;

    if (!users.length) {
      if (userGrid) userGrid.innerHTML = '';
      if (grid) {
        hideFilePager();
        if (!q) {
          grid.innerHTML = '<div class="muted">No suggestions yet. Start typing a username above.</div>';
        } else if (tooShort) {
          grid.innerHTML = '<div class="muted">Keep typing to search for people.</div>';
        } else if (matchedSelf) {
          grid.innerHTML = '<div class="muted">You can’t open your own profile here. Ask a friend to sign up, then search their name. Your files are under Upload files.</div>';
        } else {
          grid.innerHTML = '<div class="muted">No matching usernames. They need an account first.</div>';
        }
      }
      return;
    }

    if (userGrid) {
      userGrid.hidden = false;
      userGrid.classList.remove('is-leaving');
      userGrid.innerHTML = users.map((u, i) => userCardHtml(u, i)).join('');
      userGrid.querySelectorAll('.user-card').forEach((btn) => {
        btn.addEventListener('click', () => {
          const user = userCache.find((u) => String(u.id) === btn.getAttribute('data-user-id'));
          if (user) openUser(user, btn);
        });
      });
    }
    if (grid) {
      hideFilePager();
      grid.innerHTML = '<div class="muted">Pick a person above to see their files.</div>';
    }
  }

  async function searchUsers(query) {
    currentQuery = (query || '').trim();
    selectedUser = null;
    if (profileBanner) {
      profileBanner.hidden = true;
      profileBanner.innerHTML = '';
    }
    if (sectionTitle) sectionTitle.textContent = 'Find people';
    if (sectionText) sectionText.textContent = 'Search by username to find someone. Results appear after you type at least 2 characters.';

    if (userGrid) userGrid.innerHTML = '';

    if (!currentQuery || currentQuery.length < MIN_SEARCH_LEN) {
      renderUsers([], currentQuery);
      return;
    }

    hideFilePager();
    if (grid) grid.innerHTML = '<div class="muted">Searching…</div>';

    try {
      const url = `/Extract/api/users.php?q=${encodeURIComponent(currentQuery)}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.status === 401) {
        window.location.href = '/Extract/app/login.php';
        return;
      }
      const data = await res.json();
      if (!data.ok) throw new Error('Failed');
      renderUsers(data.users || [], currentQuery, data);
    } catch (_) {
      if (userGrid) userGrid.innerHTML = '';
      hideFilePager();
      if (grid) grid.innerHTML = '<div class="muted">Could not search users. Sign in again and retry.</div>';
    }
  }

  const FILE_POLL_MS = 3000;
  const LIVE_ACCESS_POLL_MS = 800;

  function accessRank(status) {
    if (status === 'open' || status === 'unlocked') return 2;
    if (status === 'pending') return 1;
    return 0;
  }

  async function loadUserFiles(userId, { animate = false } = {}) {
    try {
      const res = await fetch(`/Extract/api/items.php?user_id=${encodeURIComponent(userId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        window.location.href = '/Extract/app/login.php';
        return;
      }
      const data = await res.json();
      if (!data.ok) throw new Error('Failed');
      const nextItems = data.items || [];

      if (selectedUser) {
        selectedUser.file_count = nextItems.length;
        if (profileBanner) {
          const countEl = profileBanner.querySelector('.profile-count');
          if (countEl) {
            countEl.textContent = `${nextItems.length} file${nextItems.length === 1 ? '' : 's'}`;
          }
        }
      }

      if (searchMeta && !document.querySelector('.files')?.classList.contains('is-profile')) {
        searchMeta.hidden = false;
        searchMeta.textContent = nextItems.length
          ? `${nextItems.length} file(s) from @${selectedUser?.username || 'user'}`
          : `@${selectedUser?.username || 'user'} has no uploads yet`;
      }

      const signature = nextItems.map((item) => {
        const a = item.access || {};
        return `${item.id}:${a.status || ''}:${item.title}:${item.file_size}:${item.require_password ? 1 : 0}`;
      }).join('|');
      const prevSignature = cache.map((item) => {
        const a = item.access || {};
        return `${item.id}:${a.status || ''}:${item.title}:${item.file_size}:${item.require_password ? 1 : 0}`;
      }).join('|');

      cache = nextItems;

      if (!cache.length) {
        renderFilePages();
      } else if (animate || signature !== prevSignature || !grid.querySelector('.row')) {
        renderFilePages({ animate });
      } else {
        // Quiet update: refresh badge text in place (no blink)
        grid.querySelectorAll('.row').forEach((btn) => {
          const item = cache.find((x) => String(x.id) === btn.getAttribute('data-id'));
          if (!item) return;
          const badge = accessLabel(item);
          const badgeEl = btn.querySelector('.badge');
          if (badgeEl) {
            badgeEl.className = `badge ${badge.cls}`;
            badgeEl.textContent = badge.text;
          }
        });
        syncFilePagerChrome();
      }

      if (current) {
        const fresh = cache.find((x) => x.id === current.id);
        if (fresh) {
          const prevStatus = current.access?.status;
          const nextStatus = fresh.access?.status;
          current = fresh;

          if (prevStatus !== nextStatus) {
            if (
              prevStatus
              && accessRank(prevStatus) > accessRank(nextStatus)
            ) {
              showError('This file was just locked. Request access again if you still need it.');
            }
            paintModal();
          } else if (
            (nextStatus === 'pending' || nextStatus === 'unlocked')
            && fresh.access?.seconds_left != null
          ) {
            startTimer(
              fresh.access.seconds_left,
              nextStatus === 'pending' ? 'password' : 'unlock',
              300
            );
          }
        } else {
          closeModal();
        }
      }
    } catch (_) {
      grid.innerHTML = '<div class="muted">Could not load files.</div>';
    }
  }

  let openingUser = false;

  async function openUser(user, cardEl) {
    if (openingUser) return;
    openingUser = true;
    try {
      if (cardEl) cardEl.classList.add('is-opening');
      await blackWipeCover();

      setUserMode(user);
      await loadUserFiles(user.id, { animate: true });
      window.scrollTo(0, 0);

      await blackWipeReveal();
    } finally {
      openingUser = false;
    }
  }

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (searchTimer) clearTimeout(searchTimer);
    searchUsers(searchInput?.value || '');
  });

  searchInput?.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchUsers(searchInput.value || '');
    }, 250);
  });

  clearSearch?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    currentQuery = '';
    setSearchMode();
    searchUsers('');
    searchInput?.focus();
  });

  filePrev?.addEventListener('click', () => goToFilePage(listPage - 1));
  fileNext?.addEventListener('click', () => goToFilePage(listPage + 1));

  let fileTouchX = null;
  fileViewport?.addEventListener('touchstart', (e) => {
    if (!selectedUser || cache.length <= FILE_PAGE_SIZE) return;
    fileTouchX = e.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  fileViewport?.addEventListener('touchend', (e) => {
    if (fileTouchX == null) return;
    const x = e.changedTouches[0]?.clientX ?? fileTouchX;
    const dx = x - fileTouchX;
    fileTouchX = null;
    if (Math.abs(dx) < 45) return;
    goToFilePage(listPage + (dx < 0 ? 1 : -1));
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!selectedUser || cache.length <= FILE_PAGE_SIZE) return;
    if (modal && !modal.hidden) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToFilePage(listPage - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToFilePage(listPage + 1);
    }
  });

  setInterval(() => {
    if (document.body.classList.contains('view-files') && selectedUser) {
      loadUserFiles(selectedUser.id);
    }
  }, FILE_POLL_MS);

  setInterval(() => {
    if (modal && !modal.hidden && current) {
      const st = current.access?.status;
      if (st === 'unlocked' || st === 'pending') {
        refreshAccessStatus();
      }
    }
  }, LIVE_ACCESS_POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && selectedUser) {
      loadUserFiles(selectedUser.id);
    }
    if (document.visibilityState === 'visible' && modal && !modal.hidden && current) {
      refreshAccessStatus();
    }
  });

  if (window.SE_OPEN_BROWSE) {
    goToFiles({ animate: false });
  }
})();
