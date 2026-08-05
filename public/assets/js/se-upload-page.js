(function () {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function flash(msg, ok, pending) {
    const box = document.getElementById('flashBox');
    if (!box) return;
    if (!msg) { box.innerHTML = ''; return; }
    const cls = pending ? ' pending' : (ok ? ' ok' : '');
    box.innerHTML = `<div class="alert${cls}">${esc(msg)}</div>`;
  }

  function ownerRowHtml(item) {
    const requirePassword = !!item.require_password;
    const unlockedCount = Number(item.unlocked_count || 0);
    const activeClass = item.is_active ? '' : ' off';
    const lockBtn = unlockedCount > 0
      ? `<button type="button" class="ghost small" data-action="lock_all" data-item-id="${item.id}">Lock again</button>`
      : '';
    const copyBtn = !requirePassword
      ? `<button type="button" class="ghost small js-copy-link" data-item-id="${item.id}" data-mime="${esc(item.mime_type)}">Copy link</button>`
      : '';
    return `
<article class="item-row${activeClass}">
  <div>
    <h3>${esc(item.title)}</h3>
    <p>
      by ${esc(item.uploader || 'unknown')}
      · ${requirePassword ? 'Password required' : 'Open file'}
      · ${esc(item.original_name)}
      · ${esc(window.SEStore.formatBytes(item.file_size))}
    </p>
  </div>
  <div class="item-actions">
    <button type="button" class="ghost small" data-action="toggle_password" data-item-id="${item.id}">${requirePassword ? 'Make open' : 'Need password'}</button>
    ${lockBtn}
    ${copyBtn}
    <button type="button" class="ghost small" data-action="toggle" data-item-id="${item.id}">${item.is_active ? 'Hide' : 'Show'}</button>
    <button type="button" class="ghost small btn-delete" data-action="delete" data-item-id="${item.id}">Delete</button>
  </div>
</article>`;
  }

  function renderOwnerItems(items) {
    const mount = document.getElementById('ownerItemsMount');
    if (!mount) return;
    if (!items.length) {
      mount.innerHTML = '<p class="empty">Nothing uploaded yet.</p>';
      return;
    }
    const pageSize = 4;
    const pages = Math.ceil(items.length / pageSize);
    const multi = pages > 1;
    let trackHtml = '';
    if (multi) {
      for (let p = 0; p < pages; p += 1) {
        const chunk = items.slice(p * pageSize, (p + 1) * pageSize);
        trackHtml += `<div class="owner-page" data-page="${p}">${chunk.map(ownerRowHtml).join('')}</div>`;
      }
    } else {
      trackHtml = items.map(ownerRowHtml).join('');
    }
    let dotsHtml = '';
    if (multi) {
      for (let i = 0; i < pages; i += 1) {
        dotsHtml += `<button type="button" class="owner-dot${i === 0 ? ' is-active' : ''}" data-page="${i}" aria-label="Page ${i + 1} of ${pages}"></button>`;
      }
    }
    mount.innerHTML = `
<div class="owner-pager" id="ownerPager" data-pages="${pages}">
  <button type="button" class="owner-pager-nav owner-pager-prev" id="ownerPrev"${multi ? '' : ' hidden'} aria-label="Previous files" disabled>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div class="owner-pager-viewport" id="ownerViewport">
    <div class="item-table${multi ? ' is-paged' : ''}" id="ownerTrack">${trackHtml}</div>
  </div>
  <button type="button" class="owner-pager-nav owner-pager-next" id="ownerNext"${multi ? '' : ' hidden'} aria-label="Next files">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
</div>
<div class="owner-pager-dots" id="ownerDots"${multi ? '' : ' hidden'}>${dotsHtml}</div>`;
    bindItemActions(mount);
    if (window.SE_bindOwnerPager) window.SE_bindOwnerPager();
  }

  async function bindItemActions(root) {
    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const itemId = Number(btn.getAttribute('data-item-id') || 0);
        if (!itemId) return;
        if (action === 'delete' && !window.confirm('Delete this file?')) return;
        btn.disabled = true;
        let res;
        if (action === 'toggle_password') res = await window.SEStore.togglePassword(itemId);
        else if (action === 'lock_all') res = await window.SEStore.lockAll(itemId);
        else if (action === 'toggle') res = await window.SEStore.toggleVisibility(itemId);
        else if (action === 'delete') res = await window.SEStore.deleteItem(itemId);
        else return;
        if (res && res.ok) {
          flash(res.message, true);
          renderOwnerItems(await window.SEStore.listOwnerItems());
          if (window.SE_refreshNotifications) await window.SE_refreshNotifications();
        } else {
          flash((res && res.error) || 'Action failed.', false);
          btn.disabled = false;
        }
      });
    });
  }

  async function initUploadPage() {
    if (!window.SE_requireAuth || !(await window.SE_requireAuth())) return;
    renderOwnerItems(await window.SEStore.listOwnerItems());

    const cfg = window.SEStore.getUploadConfig
      ? await window.SEStore.getUploadConfig()
      : { max_label: '1 GB' };
    const maxLabel = cfg.max_label || '1 GB';
    const fileNameEl = document.getElementById('fileName');
    if (fileNameEl && /max/i.test(fileNameEl.textContent || '')) {
      fileNameEl.textContent = `or click to browse — max ${maxLabel}`;
    }
    window.__SE_UPLOAD_MAX_LABEL = maxLabel;

    const form = document.querySelector('form.upload-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"], .btn-upload, button.primary');
      const fd = new FormData(form);
      const file = fd.get('file');
      if (!(file instanceof File) || !file.size) {
        flash('Choose a file to upload.', false);
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalLabel = submitBtn.textContent || 'Upload';
        submitBtn.textContent = 'Uploading…';
      }
      flash(file.size > 3.5 * 1024 * 1024
        ? 'Uploading in parts — keep this tab open until it finishes…'
        : 'Uploading — please wait…', false, true);
      const res = await window.SEStore.uploadItem({
        title: fd.get('title'),
        description: fd.get('description'),
        file,
        require_password: fd.get('require_password') === '1' || !!form.querySelector('[name="require_password"]')?.checked,
        onProgress({ phase, percent, current, total }) {
          if (!submitBtn) return;
          if (phase === 'finishing') {
            submitBtn.textContent = 'Finishing…';
            flash('Finishing upload — almost done…', false, true);
            return;
          }
          if (total && current) {
            submitBtn.textContent = `Uploading ${percent || 0}% (${current}/${total})`;
            flash(`Uploading ${percent || 0}% — keep this tab open…`, false, true);
          } else {
            submitBtn.textContent = `Uploading ${percent || 0}%`;
          }
        },
      });
      if (res && res.ok) {
        flash(res.message || 'File uploaded.', true);
        form.reset();
        const fileName = document.getElementById('fileName');
        const dropzone = document.getElementById('dropzone');
        if (fileName) fileName.textContent = `or click to browse — max ${window.__SE_UPLOAD_MAX_LABEL || maxLabel}`;
        dropzone?.classList.remove('has-file');
        let items = await window.SEStore.listOwnerItems();
        // If the list API lags, still show the file we just uploaded.
        if ((!items || !items.length) && res.item && res.item.id) {
          items = [res.item];
        } else if (res.item && res.item.id && !items.some((it) => Number(it.id) === Number(res.item.id))) {
          items = [res.item].concat(items || []);
        }
        if (!items.length) {
          // One retry — Redis DB can be briefly stale right after insert.
          await new Promise((r) => setTimeout(r, 400));
          items = await window.SEStore.listOwnerItems();
          if ((!items || !items.length) && res.item && res.item.id) items = [res.item];
        }
        renderOwnerItems(items || []);
        if (!items || !items.length) {
          flash('Upload finished, but the file list did not refresh. Reload the page.', false);
        }
      } else {
        flash((res && res.error) || 'Upload failed. The file is only selected — click Upload again.', false);
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalLabel || 'Upload';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUploadPage);
  else initUploadPage();
})();
