// Glide Autoscroll — background worker.

(() => {
  'use strict';

  const FILES = ['shared.js', 'content.js'];
  const INJECTABLE = /^(https?|file):/i;

  async function hasLiveCopy(tabId) {
    try { return (await chrome.tabs.sendMessage(tabId, { __glide: true, type: 'ping' })) === true; }
    catch (_) { return false; }
  }

  // Tabs that were open before the extension was installed, updated or switched back on
  // have no working content script (after an update they hold a dead old copy). Give every
  // such tab the current one; it retires any old copy itself.
  async function sweepTabs() {
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
    await Promise.all(tabs.map(async tab => {
      if (!tab.id || tab.discarded || !INJECTABLE.test(tab.url || '')) return;
      if (await hasLiveCopy(tab.id)) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: FILES,
          injectImmediately: true
        });
      } catch (_) {}
    }));
  }

  // Content scripts in different frames of a page talk to each other with window messages.
  // They stamp those with this key, which page scripts have no way to read, so a page can't
  // forge them.
  async function ensureFrameKey() {
    try {
      const { frameKey } = await chrome.storage.local.get('frameKey');
      if (typeof frameKey !== 'string') await chrome.storage.local.set({ frameKey: crypto.randomUUID() });
    } catch (_) {}
  }

  // Session storage is wiped on install, update, re-enable and browser restart: exactly the
  // moments a sweep can be needed. The flag keeps ordinary worker restarts from repeating it.
  let sweeping = null;
  function sweepOncePerSession() {
    sweeping ??= (async () => {
      await ensureFrameKey();
      try {
        const { swept } = await chrome.storage.session.get('swept');
        if (swept) return;
        await chrome.storage.session.set({ swept: true });
      } catch (_) {}
      await sweepTabs();
    })();
    return sweeping;
  }

  // The browser starts this worker when the extension is installed, updated or switched
  // back on, so running the check on every start covers all three.
  sweepOncePerSession();
  chrome.runtime.onInstalled.addListener(sweepOncePerSession);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.__glide !== true || !sender.tab) return;

    // Page zoom, so the glide moves at the same visual speed at any zoom level.
    if (msg.type === 'zoom?') {
      chrome.tabs.getZoom(sender.tab.id).then(z => sendResponse(z), () => sendResponse(null));
      return true;
    }

    // Everything else is relayed to every frame of the same tab: a driving frame tells the
    // others it has started or stopped, and they send it pointer positions and stop requests.
    chrome.tabs.sendMessage(sender.tab.id, msg).catch(() => {});
  });

  chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
    chrome.tabs.sendMessage(tabId, { __glide: true, type: 'zoom', zoom: newZoomFactor }).catch(() => {});
  });
})();
