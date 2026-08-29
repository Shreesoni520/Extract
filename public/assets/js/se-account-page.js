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
      if (!file) {
        flash('Choose a profile image first.', false);
        return;
      }
      const btn = avatarForm.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalLabel = btn.textContent || 'Save image';
        btn.textContent = 'Saving…';
      }
      const res = await window.SEStore.updateAvatar(file);
      if (res && res.ok) {
        flash(res.message || 'Profile image saved.', true);
        const u = window.SEStore.getCurrentUser();
        if (preview) {
          if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.name || '')) {
            if (preview.dataset.blob) URL.revokeObjectURL(preview.dataset.blob);
            const url = URL.createObjectURL(file);
            preview.dataset.blob = url;
            preview.src = url;
          } else if (u) {
            preview.src = `${window.SEStore.avatarUrl(u.avatar, u.id)}&t=${Date.now()}`;
          }
        }
      } else flash((res && res.error) || 'Could not save image.', false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalLabel || 'Save image';
      }
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

      if (!window.SEStore.isValidUsername || !window.SEStore.isValidUsername(username)) {
        flash('Username must be 3-20 letters, numbers, dots, or underscores.', false);
        return;
      }

      let passwordUpdated = false;
      if (newPassword || confirmPassword) {
        if (newPassword.length < 4) {
          flash('Password must be at least 4 characters.', false);
          newPass?.focus();
          return;
        }
        if (newPassword !== confirmPassword) {
          flash('Passwords do not match.', false);
          confirmPass?.focus();
          return;
        }
        if (!currentPassword) {
          flash('Enter your current sign-in password to set a new one.', false);
          syncPassFields();
          currentPass?.focus();
          return;
        }
        passwordUpdated = true;
      }

      const btn = accountForm.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalLabel = btn.textContent || 'Save changes';
        btn.textContent = 'Saving…';
      }

      const res = await window.SEStore.updateAccount({
        new_username: username,
        new_password: newPassword || '',
        confirm_password: confirmPassword || '',
        current_password: currentPassword || '',
      });

      if (res && res.ok) {
        if (username) await window.SEStore.renameLocalAccount(username);
        flash(
          passwordUpdated
            ? (res.message || 'Password updated. Use the new password next time you sign in.')
            : (res.message || 'Account updated.'),
          true,
        );
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
