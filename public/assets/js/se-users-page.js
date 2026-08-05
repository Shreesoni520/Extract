(function () {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function flash(msg, ok) {
    const okEl = document.getElementById('flashOk');
    const errEl = document.getElementById('flashErr');
    if (okEl) okEl.innerHTML = ok ? `<div class="alert ok">${esc(msg)}</div>` : '';
    if (errEl) errEl.innerHTML = !ok ? `<div class="alert">${esc(msg)}</div>` : '';
  }

  function renderUsers(users, meId) {
    const mount = document.getElementById('usersMount');
    if (!mount) return;
    mount.innerHTML = users.map((u) => {
      const isMe = u.id === meId;
      const actions = isMe
        ? '<span class="hint">You</span>'
        : `<button type="button" class="ghost small" data-delete-user="${u.id}">Delete</button>`;
      return `<article class="item-row"><div><h3>${esc(u.username)}</h3><p>${u.upload_count} upload(s) · joined ${esc(u.created_at)}</p></div><div class="item-actions">${actions}</div></article>`;
    }).join('');
    mount.querySelectorAll('[data-delete-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-delete-user'));
        if (!window.confirm('Delete this user and their files?')) return;
        const res = await window.SEStore.deleteUser(id);
        if (res.ok) {
          flash(res.message, true);
          renderUsers(await window.SEStore.listAllUsers(), window.SEStore.getCurrentUser().id);
        } else flash(res.error, false);
      });
    });
  }

  async function initUsers() {
    if (!window.SE_requireAuth || !(await window.SE_requireAuth())) return;
    const me = window.SEStore.getCurrentUser();
    renderUsers(await window.SEStore.listAllUsers(), me.id);

    const form = document.querySelector('form.upload-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const res = await window.SEStore.addUser(fd.get('username'), fd.get('password'), fd.get('confirm'));
      if (res.ok) {
        flash(res.message, true);
        form.reset();
        renderUsers(await window.SEStore.listAllUsers(), me.id);
      } else flash(res.error, false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUsers);
  else initUsers();
})();
