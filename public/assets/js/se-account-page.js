(function () {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function flash(msg, ok) {
    const okEl = document.getElementById('flashOk');
    const errEl = document.getElementById('flashErr');
    if (okEl) okEl.innerHTML = ok ? `<div class="alert ok">${esc(msg)}</div>` : '';
    if (errEl) errEl.innerHTML = !ok ? `<div class="alert">${esc(msg)}</div>` : '';
    if (!ok && errEl) errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function syncPassFields() {
    const newPass = document.getElementById('newPassword');
    const confirmPass = document.getElementById('confirmPassword');
    const currentWrap = document.getElementById('currentPassWrap');
    const currentPass = document.getElementById('currentPassword');
    const passHint = document.getElementById('passHint');
    const changing = !!(newPass?.value || confirmPass?.value);
    if (currentWrap) currentWrap.hidden = !changing;
    if (passHint) passHint.hidden = !changing;
    if (currentPass) {
      currentPass.required = changing;
      if (!changing) currentPass.value = '';
    }
  }

  async function initAccount() {
    if (!window.SE_requireAuth || !(await window.SE_requireAuth())) return;
    const me = window.SEStore.getCurrentUser();
    const preview = document.getElementById('avatarPreview');
    if (preview && me) preview.src = window.SEStore.avatarUrl(me.avatar, me.id);
    const userInput = document.querySelector('#usernameInput, [name="new_username"]');
    if (userInput && me) userInput.value = me.username || '';

    const avatarForm = document.getElementById('avatarForm');
    avatarForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = avatarForm.querySelector('#avatarInput')?.files?.[0];
      const res = await window.SEStore.updateAvatar(file);
      if (res.ok) {
        flash(res.message, true);
        const u = window.SEStore.getCurrentUser();
        if (preview && u) preview.src = `${window.SEStore.avatarUrl(u.avatar, u.id)}&_=${Date.now()}`;
      } else flash(res.error || 'Could not save image.', false);
    });

    const accountForm = document.getElementById('accountForm');
    const newPass = document.getElementById('newPassword');
    const confirmPass = document.getElementById('confirmPassword');
    const currentPass = document.getElementById('currentPassword');
    newPass?.addEventListener('input', syncPassFields);
    confirmPass?.addEventListener('input', syncPassFields);
    syncPassFields();

    accountForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      flash('', true);

      const username = String(accountForm.querySelector('[name="new_username"]')?.value || '').trim();
      const newPassword = String(newPass?.value || '');
      const confirmPassword = String(confirmPass?.value || '');
      const currentPassword = String(currentPass?.value || '');

      if (username.length < 3) {
        flash('Username must be at least 3 characters.', false);
        return;
      }

      if (newPassword || confirmPassword) {
        if (newPassword.length < 8) {
          flash('New password must be at least 8 characters.', false);
          newPass?.focus();
          return;
        }
        if (newPassword !== confirmPassword) {
          flash('New password and confirm do not match.', false);
          confirmPass?.focus();
          return;
        }
        if (!currentPassword) {
          flash('Enter your current sign-in password to set a new one.', false);
          syncPassFields();
          currentPass?.focus();
          return;
        }
      }

      const btn = accountForm.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalLabel = btn.textContent || 'Save changes';
        btn.textContent = 'Saving…';
      }

      const res = await window.SEStore.updateAccount({
        new_username: username,
        new_password: newPassword,
        confirm_password: confirmPassword,
        current_password: currentPassword,
      });

      if (res && res.ok) {
        flash(res.message || 'Account updated.', true);
        if (newPass) newPass.value = '';
        if (confirmPass) confirmPass.value = '';
        if (currentPass) currentPass.value = '';
        syncPassFields();
        if (userInput && res.username) userInput.value = res.username;
        else if (userInput) {
          const u = window.SEStore.getCurrentUser();
          if (u) userInput.value = u.username || userInput.value;
        }
      } else {
        flash((res && res.error) || 'Could not update account.', false);
        if (res && res.code === 'BAD_CURRENT_PASSWORD') currentPass?.focus();
      }

      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalLabel || 'Save changes';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAccount);
  else initAccount();
})();
