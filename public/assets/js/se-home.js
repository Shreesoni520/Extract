(function () {
  'use strict';

  const APP_NAME = "Shree's Extractions";

  function root() {
    if (window.SEStore && typeof window.SEStore.root === 'string') {
      return window.SEStore.root;
    }
    if (!/^\/Extract(\/|$)/i.test(window.location.pathname)) return '';
    return '/Extract';
  }

  function escapeText(str) {
    return String(str || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }

  function heroGuest() {
    return `
<p class="hero-line">Private file sharing for people you trust. Sign in to find someone and open their files.</p>
<div class="hero-actions">
  <a class="btn" href="${root()}/app/login.html">Sign in</a>
  <a class="btn btn-ghost" href="${root()}/app/register.html">Sign up</a>
</div>`;
  }

  function heroLoggedIn(username) {
    return `
<p class="hero-line">Welcome back, ${escapeText(username)}. Find people, open files, or upload something new.</p>
<div class="hero-actions">
  <button class="btn" id="browseBtn" type="button">Find people</button>
  <a class="btn btn-ghost" href="${root()}/app/index.html">Upload files</a>
</div>
<p class="hero-auth">
  <a href="${root()}/app/account.html">Account</a>
  &middot;
  <button type="button" class="linkish" id="logoutLink" data-se-logout="1">Logout</button>
</p>`;
  }

  function browseSectionHtml() {
    const r = root();
    return `
<section class="files-view" id="filesView" hidden>
  <div class="files-wrap">
    <nav class="app-nav" aria-label="Main">
      <button class="nav-btn" id="backBtn" type="button">&larr; Back</button>
      <div class="app-nav-end">
        <a class="nav-btn" href="${r}/app/index.html">Upload files</a>
        <a class="nav-btn" href="${r}/app/account.html">Account</a>
        <button type="button" class="nav-btn" data-se-theme="1" aria-label="Toggle dark mode" aria-pressed="false">Dark</button>
        <button type="button" class="nav-btn nav-btn-dark" id="navLogout" data-se-logout="1">Logout</button>
      </div>
    </nav>
    <div class="files">
      <div class="section-head">
        <h2 id="sectionTitle">Find people</h2>
        <p id="sectionText">Search by username to find someone. Results appear after you type at least 2 characters.</p>
      </div>
      <form id="searchForm" class="search-bar" role="search">
        <label class="search-field" for="searchInput">
          <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
            <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input id="searchInput" type="search" name="people_query" placeholder="Search by username…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        </label>
        <div class="search-actions">
          <button type="button" class="search-clear" id="clearSearch" hidden aria-label="Clear search">Clear</button>
          <button type="submit" class="btn search-submit">Search</button>
        </div>
      </form>
      <p id="searchMeta" class="search-meta" hidden></p>
      <div id="userGrid" class="user-grid" aria-live="polite"></div>
      <div id="profileBanner" class="profile-banner" hidden></div>
      <div id="fileListBox" class="file-list-box">
        <div class="file-list-head" id="fileListHead" hidden>
          <h3>All files</h3>
          <p id="fileListHint">Tap a file to open it</p>
        </div>
        <div class="file-pager" id="filePager">
          <button type="button" class="file-pager-nav file-pager-prev" id="filePrev" hidden aria-label="Previous files">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="file-pager-viewport" id="fileViewport">
            <div id="grid" class="list" aria-live="polite"><div class="muted">Search for people above.</div></div>
          </div>
          <button type="button" class="file-pager-nav file-pager-next" id="fileNext" hidden aria-label="Next files">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="file-pager-dots" id="fileDots" hidden></div>
      </div>
    </div>
    <footer class="foot"><p>${APP_NAME}</p></footer>
  </div>
</section>
<div id="modal" class="modal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <button class="icon-btn" id="modalClose" type="button" aria-label="Close">✕</button>
    <p class="kicker" id="modalKicker">Access</p>
    <h3 id="modalTitle">Request access</h3>
    <p id="modalMeta" class="sheet-meta" hidden></p>
    <p id="modalText" class="body-text"></p>
    <div id="timerWrap" class="timer" hidden>
      <div class="bar"><span id="timerBar"></span></div>
      <p id="timerLabel">00:00</p>
    </div>
    <div id="unlockedActions" class="actions" hidden>
      <a id="viewBtn" class="btn" href="#" target="_blank" rel="noopener">View</a>
      <a id="downloadBtn" class="btn btn-ghost" href="#">Download</a>
      <button type="button" id="copyLinkBtn" class="btn btn-ghost" hidden>Copy link</button>
      <button id="chatBtn" type="button" class="btn btn-ghost" hidden>Chat</button>
    </div>
    <p id="copyLinkHint" class="copy-hint" hidden>Anyone with this link can open the file — no password needed.</p>
    <form id="passForm" class="pass-form" hidden>
      <label><span>Password</span><input id="passInput" type="text" maxlength="12" autocomplete="one-time-code" placeholder="Enter code" /></label>
      <button type="submit" class="btn">Unlock</button>
    </form>
    <p id="modalError" class="error" hidden></p>
    <button id="requestBtn" type="button" class="btn" hidden>Request password</button>
  </div>
</div>`;
  }

  function paintHero(loggedIn, username) {
    const heroExtra = document.getElementById('heroContent');
    if (!heroExtra) return;
    heroExtra.innerHTML = loggedIn ? heroLoggedIn(username) : heroGuest();
  }

  function bindHomeActions() {
    const browseBtn = document.getElementById('browseBtn');
    if (browseBtn && browseBtn.dataset.bound !== '1') {
      browseBtn.dataset.bound = '1';
      browseBtn.addEventListener('click', () => {
        // Prefer in-page swap (no full reload).
        if (typeof window.SE_goToFiles === 'function') {
          window.SE_goToFiles();
          return;
        }
        window.location.href = `${root()}/?browse=1`;
      });
    }

    // Logout is bound by se-auth.js via [data-se-logout] (and re-bound on se-home-ready).
  }

  function mountBrowseOnce() {
    const mount = document.getElementById('browseMount');
    if (mount && !document.getElementById('filesView')) {
      mount.innerHTML = browseSectionHtml();
    }
    if (!window.__SE_HOME_READY_FIRED) {
      window.__SE_HOME_READY_FIRED = true;
      window.dispatchEvent(new Event('se-home-ready'));
    }
  }

  async function initHome() {
    if (window.__SE_HOME_INIT) return;
    window.__SE_HOME_INIT = true;

    const params = new URLSearchParams(window.location.search);
    const forcedLogout = params.get('logged_out') === '1';
    if (forcedLogout) {
      try { sessionStorage.removeItem('se_user_hint'); } catch (_) {}
      if (window.SEStore && typeof window.SEStore.logout === 'function') {
        try {
          await Promise.race([
            window.SEStore.logout(),
            new Promise((r) => setTimeout(r, 1200)),
          ]);
        } catch (_) {}
      }
      if (window.history && window.history.replaceState) {
        try { window.history.replaceState({}, '', `${root()}/`); } catch (_) {}
      }
    }

    const openBrowse = params.get('browse') === '1';
    const hint = (!forcedLogout && window.SEStore && window.SEStore.readUserHint)
      ? window.SEStore.readUserHint()
      : null;

    // Guest path: instant paint (no waiting) — same snappy feel as before.
    if (!hint || !hint.username) {
      paintHero(false);
      bindHomeActions();
      window.SE_LOGGED_IN = false;
      window.SE_OPEN_BROWSE = false;
      document.body?.setAttribute('data-logged-in', '0');

      if (!window.SEStore) return;
      await window.SEStore.init({ force: !!forcedLogout });
      if (typeof window.SEStore.whenReady === 'function') {
        try { await window.SEStore.whenReady(); } catch (_) {}
      }
      // Only upgrade if a real session exists (no hint yet, e.g. first login cookie).
      if (!forcedLogout && window.SEStore.adminLoggedIn()) {
        const u = window.SEStore.getCurrentUser();
        paintHero(true, u && u.username);
        bindHomeActions();
        window.SE_LOGGED_IN = true;
        window.SE_OPEN_BROWSE = openBrowse;
        document.body?.setAttribute('data-logged-in', '1');
        mountBrowseOnce();
      }
      return;
    }

    // Logged-in path: paint once from hint (instant), confirm session quietly.
    // Do NOT paint again after /me unless the username changed or session is gone.
    paintHero(true, hint.username);
    bindHomeActions();
    window.SE_LOGGED_IN = true;
    window.SE_OPEN_BROWSE = openBrowse;
    document.body?.setAttribute('data-logged-in', '1');
    mountBrowseOnce();

    if (!window.SEStore) return;
    await window.SEStore.init({ force: !!forcedLogout });
    if (typeof window.SEStore.whenReady === 'function') {
      try { await window.SEStore.whenReady(); } catch (_) {}
    }

    if (forcedLogout || !window.SEStore.adminLoggedIn()) {
      window.SE_LOGGED_IN = false;
      window.SE_OPEN_BROWSE = false;
      document.body?.setAttribute('data-logged-in', '0');
      paintHero(false);
      bindHomeActions();
      const mount = document.getElementById('browseMount');
      if (mount) mount.innerHTML = '';
      return;
    }

    const u = window.SEStore.getCurrentUser();
    const name = u && u.username ? String(u.username) : '';
    if (name && name !== String(hint.username || '')) {
      paintHero(true, name);
      bindHomeActions();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHome);
  else initHome();
})();
