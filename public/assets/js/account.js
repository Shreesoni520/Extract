(() => {
  const input = document.getElementById('avatarInput');
  const pick = document.getElementById('avatarPick');
  const nameEl = document.getElementById('avatarFileName');
  const preview = document.getElementById('avatarPreview');
  if (input && pick) {
    const showFile = (file) => {
      if (!file) return;
      pick.classList.add('has-file');
      if (nameEl) nameEl.textContent = file.name;
      if (preview && file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        preview.onload = () => URL.revokeObjectURL(url);
        preview.src = url;
      }
    };

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      showFile(file);
    });

    ['dragenter', 'dragover'].forEach((ev) => {
      pick.addEventListener(ev, (e) => {
        e.preventDefault();
        pick.classList.add('has-file');
      });
    });
    pick.addEventListener('dragleave', () => {
      if (!(input.files && input.files[0])) pick.classList.remove('has-file');
    });
    pick.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      showFile(file);
    });
  }

  const newPass = document.getElementById('newPassword');
  const confirmPass = document.getElementById('confirmPassword');
  const currentWrap = document.getElementById('currentPassWrap');
  const currentPass = document.getElementById('currentPassword');
  const passHint = document.getElementById('passHint');

  const syncPassFields = () => {
    const changing = !!(newPass?.value || confirmPass?.value);
    if (currentWrap) currentWrap.hidden = !changing;
    if (passHint) passHint.hidden = !changing;
    if (currentPass) {
      currentPass.required = changing;
      if (!changing) currentPass.value = '';
    }
  };

  newPass?.addEventListener('input', syncPassFields);
  confirmPass?.addEventListener('input', syncPassFields);
  syncPassFields();
})();
