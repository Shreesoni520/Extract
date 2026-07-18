(function () {
  var CURSOR_POS_KEY = 'siteDotCursorPos';
  var HIDDEN_CURSOR =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='rgba(0%2C0%2C0%2C0.001)'/%3E%3C/svg%3E\") 16 16, none";

  var HOT_SELECTOR = [
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    "[role='button']",
    '.nav-btn',
    '.btn',
    '.btn-ghost',
    '.icon-btn',
    '.user-card',
    '.row',
    '.search-field',
    '.search-clear',
    '.search-submit',
    '.notif-item',
    '.item-actions button',
    'label',
  ].join(', ');

  function readStoredCursorPos() {
    try {
      var raw = sessionStorage.getItem(CURSOR_POS_KEY);
      if (!raw) return null;
      var pos = JSON.parse(raw);
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y)) return null;
      return { x: pos.x, y: pos.y };
    } catch (err) {
      return null;
    }
  }

  function storeCursorPos(x, y) {
    try {
      sessionStorage.setItem(CURSOR_POS_KEY, JSON.stringify({ x: x, y: y }));
    } catch (err) {}
  }

  function initSiteCursor() {
    if (!document.documentElement.classList.contains('has-dot-cursor')) return;
    if (!window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;

    function lockSystemCursor() {
      document.documentElement.style.setProperty('cursor', HIDDEN_CURSOR, 'important');
      if (document.body) {
        document.body.style.setProperty('cursor', HIDDEN_CURSOR, 'important');
      }
    }

    function burstLockCursor() {
      lockSystemCursor();
      var frames = 0;
      function tick() {
        lockSystemCursor();
        if (++frames < 10) window.requestAnimationFrame(tick);
      }
      window.requestAnimationFrame(tick);
    }

    var root = document.querySelector('.site-cursor--boot');
    if (!root) {
      root = document.createElement('div');
      root.className = 'site-cursor';
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML =
        '<div class="site-cursor__ring"></div><div class="site-cursor__dot"></div>';
      document.body.appendChild(root);
    } else {
      root.classList.remove('site-cursor--boot');
    }

    var ring = root.querySelector('.site-cursor__ring');
    var dot = root.querySelector('.site-cursor__dot');
    if (!ring || !dot) return;

    var targetX = -100;
    var targetY = -100;
    var ringX = -100;
    var ringY = -100;
    var loopId = 0;
    var ringEase = 0.13;

    var stored = readStoredCursorPos();
    if (stored) {
      targetX = stored.x;
      targetY = stored.y;
      ringX = stored.x;
      ringY = stored.y;
    }

    function isInsideViewport(x, y) {
      return x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
    }

    function hideCursor() {
      root.classList.remove('is-visible', 'is-active', 'is-clicking', 'is-ready');
    }

    function showCursor() {
      root.classList.add('is-visible', 'is-ready');
    }

    function placeEl(el, px, py) {
      el.style.transform =
        'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0) translate(-50%,-50%)';
    }

    function paint() {
      placeEl(dot, targetX, targetY);
      placeEl(ring, ringX, ringY);
    }

    function loop() {
      ringX += (targetX - ringX) * ringEase;
      ringY += (targetY - ringY) * ringEase;
      paint();
      loopId = window.requestAnimationFrame(loop);
    }

    function setTarget(x, y) {
      targetX = x;
      targetY = y;
      storeCursorPos(x, y);
      showCursor();
    }

    function updateHotState(target) {
      var hot = target && target.closest && target.closest(HOT_SELECTOR);
      root.classList.toggle('is-active', !!hot);
    }

    function trackMove(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (!isInsideViewport(e.clientX, e.clientY)) {
        hideCursor();
        return;
      }
      lockSystemCursor();
      setTarget(e.clientX, e.clientY);
      updateHotState(e.target);
    }

    function onMouse(e) {
      if (e.type === 'mousedown') {
        burstLockCursor();
        root.classList.add('is-clicking');
      }
      if (e.type === 'mouseup' || e.type === 'click') {
        burstLockCursor();
        root.classList.remove('is-clicking');
      }
    }

    lockSystemCursor();
    burstLockCursor();
    paint();
    loopId = window.requestAnimationFrame(loop);

    document.addEventListener('pointermove', trackMove, { passive: true, capture: true });
    document.addEventListener('mousemove', trackMove, { passive: true, capture: true });
    document.addEventListener(
      'mouseover',
      function (e) {
        updateHotState(e.target);
      },
      { passive: true, capture: true }
    );
    document.addEventListener('mousedown', onMouse, { passive: true, capture: true });
    document.addEventListener('mouseup', onMouse, { passive: true, capture: true });
    document.addEventListener('click', onMouse, { passive: true, capture: true });
    document.documentElement.addEventListener('mouseleave', hideCursor);
    window.addEventListener('blur', hideCursor);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSiteCursor);
  } else {
    initSiteCursor();
  }
})();
