(function () {
  'use strict';

  const MAX_CHARS = 150;
  let pollTimer = null;
  let activeRequestId = 0;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function peerInitial(name) {
    const clean = String(name || '').replace(/^@/, '').trim();
    return (clean.charAt(0) || '?').toUpperCase();
  }

  function updateCount() {
    const input = document.getElementById('seChatInput');
    const count = document.getElementById('seChatCount');
    if (!input || !count) return;
    const n = input.value.length;
    count.textContent = `${n} / ${MAX_CHARS}`;
    count.classList.toggle('is-near', n >= 120 && n < MAX_CHARS);
    count.classList.toggle('is-full', n >= MAX_CHARS);
  }

  function ensureModal() {
    let modal = document.getElementById('seChatModal');
    if (modal) {
      // Keep popup at document root so position:fixed always covers the screen.
      if (modal.parentElement !== document.body) document.body.appendChild(modal);
      return modal;
    }
    modal = document.createElement('div');
    modal.id = 'seChatModal';
    modal.className = 'se-chat-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="se-chat-sheet" role="dialog" aria-modal="true" aria-labelledby="seChatTitle">
        <button class="se-chat-close" id="seChatClose" type="button" aria-label="Close chat">✕</button>
        <div class="se-chat-head">
          <div class="se-chat-avatar" id="seChatAvatar" aria-hidden="true">?</div>
          <div class="se-chat-head-text">
            <p class="se-chat-kicker" id="seChatKicker">Private chat</p>
            <h3 class="se-chat-title" id="seChatTitle">Chat</h3>
            <div class="se-chat-meta-row">
              <span class="se-chat-file" id="seChatSub" hidden></span>
              <p class="se-chat-timer" id="seChatTimer" hidden></p>
            </div>
          </div>
        </div>
        <div class="se-chat-log" id="seChatLog" aria-live="polite"></div>
        <form class="se-chat-form" id="seChatForm">
          <div class="se-chat-composer">
            <textarea id="seChatInput" maxlength="${MAX_CHARS}" rows="1" placeholder="Write a message…" required></textarea>
            <button type="submit" class="se-chat-send" id="seChatSend">Send</button>
          </div>
          <div class="se-chat-foot">
            <span class="se-chat-hint">Enter to send</span>
            <span class="se-chat-count" id="seChatCount">0 / ${MAX_CHARS}</span>
          </div>
        </form>
        <p class="se-chat-error" id="seChatError" hidden></p>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeChat();
    });
    document.getElementById('seChatClose')?.addEventListener('click', closeChat);
    const inputEl = document.getElementById('seChatInput');
    inputEl?.addEventListener('input', () => {
      updateCount();
      if (!inputEl) return;
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(110, Math.max(46, inputEl.scrollHeight))}px`;
    });
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    document.getElementById('seChatForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await sendChat();
    });
    return modal;
  }

  function formatLeft(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function renderMessages(messages) {
    const log = document.getElementById('seChatLog');
    if (!log) return;
    if (!messages || !messages.length) {
      log.innerHTML = `
        <p class="se-chat-empty">
          <strong>No messages yet</strong>
          Say hi or share the password — this chat clears when the timer ends.
        </p>`;
      return;
    }
    log.innerHTML = messages.map((m) => {
      const mine = !!m.mine;
      const who = mine ? 'You' : (m.sender_username ? `@${m.sender_username}` : 'Them');
      return `
        <div class="se-chat-bubble ${mine ? 'is-mine' : 'is-theirs'}">
          <span class="se-chat-who">${esc(who)}</span>
          <p class="se-chat-body">${esc(m.body)}</p>
        </div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  function setError(msg) {
    const el = document.getElementById('seChatError');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }

  async function fetchChat(requestId) {
    const res = await fetch(`/api/chat/${encodeURIComponent(requestId)}?_=${Date.now()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Could not load chat');
    return data;
  }

  function paintChat(data) {
    const title = document.getElementById('seChatTitle');
    const sub = document.getElementById('seChatSub');
    const timer = document.getElementById('seChatTimer');
    const form = document.getElementById('seChatForm');
    const input = document.getElementById('seChatInput');
    const send = document.getElementById('seChatSend');
    const avatar = document.getElementById('seChatAvatar');

    const peer = data.peer_username ? `@${data.peer_username}` : 'this person';
    if (title) title.textContent = peer;
    if (avatar) avatar.textContent = peerInitial(peer);
    if (sub) {
      if (data.item_title) {
        sub.hidden = false;
        sub.textContent = data.item_title;
      } else {
        sub.hidden = true;
        sub.textContent = '';
      }
    }

    if (timer) {
      timer.hidden = false;
      timer.classList.toggle('is-ended', !!(data.closed || !data.can_send));
      if (data.closed || !data.can_send) {
        timer.textContent = 'Ended';
      } else {
        timer.textContent = formatLeft(data.seconds_left);
      }
    }

    renderMessages(data.messages || []);

    const open = !data.closed && data.can_send;
    if (form) form.hidden = !open;
    if (input) input.disabled = !open;
    if (send) send.disabled = !open;
    if (!open) setError(data.error || 'This chat is closed.');
    else setError('');
  }

  async function refreshActive() {
    if (!activeRequestId) return;
    try {
      const data = await fetchChat(activeRequestId);
      paintChat(data);
      if (data.closed || !data.can_send) stopPoll();
    } catch (err) {
      setError(err.message || 'Could not refresh chat');
    }
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(refreshActive, 2500);
  }

  async function sendChat() {
    const input = document.getElementById('seChatInput');
    const send = document.getElementById('seChatSend');
    if (!input || !activeRequestId) return;
    const body = String(input.value || '').trim();
    if (!body) return;
    if (body.length > MAX_CHARS) {
      setError(`Max ${MAX_CHARS} characters per message.`);
      return;
    }
    if (send) send.disabled = true;
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(activeRequestId)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Send failed');
      input.value = '';
      updateCount();
      await refreshActive();
    } catch (err) {
      setError(err.message || 'Could not send');
    } finally {
      if (send) send.disabled = false;
    }
  }

  async function openChat(requestId, hint) {
    const id = Number(requestId || 0);
    if (!id) return;
    activeRequestId = id;
    const modal = ensureModal();
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.hidden = false;
    document.body.classList.add('se-chat-open');
    setError('');
    const title = document.getElementById('seChatTitle');
    const avatar = document.getElementById('seChatAvatar');
    if (hint && hint.peerName) {
      if (title) title.textContent = hint.peerName;
      if (avatar) avatar.textContent = peerInitial(hint.peerName);
    }
    try {
      const data = await fetchChat(id);
      paintChat(data);
      startPoll();
      document.getElementById('seChatInput')?.focus();
    } catch (err) {
      setError(err.message || 'Could not open chat');
    }
  }

  function closeChat() {
    stopPoll();
    activeRequestId = 0;
    const modal = document.getElementById('seChatModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('se-chat-open');
  }

  window.SEChat = { open: openChat, close: closeChat };
})();
