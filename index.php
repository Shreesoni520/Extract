<?php
declare(strict_types=1);

require_once __DIR__ . '/config/auth.php';
visitor_token();
start_session();

$appName = app_config()['app']['name'];
$loggedIn = admin_logged_in();
$username = (string) ($_SESSION['admin_username'] ?? '');
$openBrowse = $loggedIn && isset($_GET['browse']);
?>
<!DOCTYPE html>
<html lang="en" class="has-dot-cursor">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= e($appName) ?></title>
  <meta name="description" content="Sign in to search people, see their files, and request access when needed." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/Extract/assets/css/dot-cursor.css?v=1" />
  <link rel="stylesheet" href="/Extract/assets/css/public.css?v=36" />
  <?php require __DIR__ . '/includes/theme-head.php'; ?>
</head>
<body class="view-landing" data-logged-in="<?= $loggedIn ? '1' : '0' ?>">
  <?php require __DIR__ . '/includes/dot-cursor.php'; ?>
  <div class="bg" aria-hidden="true"></div>
  <div class="page-veil" id="pageVeil" aria-hidden="true"></div>

  <section class="hero" id="landing">
    <div class="hero-inner">
      <h1 class="brand-hero"><?= e($appName) ?></h1>
      <?php if ($loggedIn): ?>
        <p class="hero-line">Hi <?= e($username) ?>. Search people and open their files.</p>
        <div class="hero-actions">
          <button class="btn" id="browseBtn" type="button">Find people</button>
          <a class="btn btn-ghost" href="/Extract/app/">Upload files</a>
        </div>
        <p class="hero-auth">
          <a href="/Extract/app/account.php">Account</a>
          ·
          <a href="/Extract/app/logout.php">Logout</a>
        </p>
      <?php else: ?>
        <p class="hero-line">Sign in or sign up first. Then you can find people and use files.</p>
        <div class="hero-actions">
          <a class="btn" href="/Extract/app/login.php">Sign in</a>
          <a class="btn btn-ghost" href="/Extract/app/register.php">Sign up</a>
        </div>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($loggedIn): ?>
  <section class="files-view" id="filesView" hidden>
      <div class="files-wrap">
        <?php $navContext = 'browse'; require __DIR__ . '/includes/nav.php'; ?>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="file-pager-viewport" id="fileViewport">
              <div id="grid" class="list" aria-live="polite">
                <div class="muted">Loading people…</div>
              </div>
            </div>
            <button type="button" class="file-pager-nav file-pager-next" id="fileNext" hidden aria-label="Next files">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="file-pager-dots" id="fileDots" hidden></div>
        </div>
      </div>
      <footer class="foot">
        <p><?= e($appName) ?></p>
      </footer>
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
      </div>
      <p id="copyLinkHint" class="copy-hint" hidden>Anyone with this link can open the file — no password needed.</p>
      <form id="passForm" class="pass-form" hidden>
        <label>
          <span>Password</span>
          <input id="passInput" type="text" maxlength="12" autocomplete="one-time-code" placeholder="Enter code" />
        </label>
        <button type="submit" class="btn">Unlock</button>
      </form>
      <p id="modalError" class="error" hidden></p>
      <button id="requestBtn" type="button" class="btn" hidden>Request password</button>
    </div>
  </div>
  <?php endif; ?>

  <script>
    window.SE_LOGGED_IN = <?= $loggedIn ? 'true' : 'false' ?>;
    window.SE_OPEN_BROWSE = <?= $openBrowse ? 'true' : 'false' ?>;
  </script>
  <?php if ($loggedIn): ?>
  <script src="/Extract/assets/js/public.js?v=32"></script>
  <?php
    $skipFloatingTheme = true;
    require __DIR__ . '/includes/theme-foot.php';
  ?>
  <?php else: ?>
  <?php require __DIR__ . '/includes/theme-foot.php'; ?>
  <?php endif; ?>
</body>
</html>
