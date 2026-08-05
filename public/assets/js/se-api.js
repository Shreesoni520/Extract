(function () {
  'use strict';
  if (!window.SEStore) return;

  // Let fetch go to the Node API — no interception.
  window.SE_getDownloadUrl = function SE_getDownloadUrl(itemId, mode) {
    return `/api/download?item_id=${encodeURIComponent(itemId)}&mode=${encodeURIComponent(mode || 'download')}`;
  };
})();
