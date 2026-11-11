// Glide Autoscroll — toolbar popup (needs shared.js loaded first).
(() => {
  'use strict';

  const { hostMatches } = globalThis.GlideShared;
  const $ = id => document.getElementById(id);

  // These two only take a callback in older Chromium.
  const ask = fn => new Promise(res => { try { fn(v => res(!!v)); } catch (_) { res(true); } });

  // `html` is always one of the fixed strings below, never page content.
  function note(id, html) {
    $(id).innerHTML = html;
    $(id).hidden = false;
  }

  async function init() {
    const { enabled, blocklist } = await chrome.storage.sync.get({ enabled: true, blocklist: [] });
    $('global').checked = enabled;

    const extPage = navigator.brave ? 'brave://extensions' : 'chrome://extensions';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let host = '';
    let url = null;
    try { url = new URL(tab.url); host = url.hostname.toLowerCase(); } catch (_) {}

    const ownPage = !!url && url.href.startsWith(`chrome-extension://${chrome.runtime.id}/`);
    const isFile = !!url && url.protocol === 'file:';
    const restricted = !!url && (!/^(https?|file):$/.test(url.protocol) ||
      host === 'chromewebstore.google.com' || host === 'chrome.google.com');

    $('host').textContent = ownPage ? 'Glide settings' : isFile ? 'Local file' : (host || 'This page');
    $('site').disabled = true;

    if (!url) {
      // The browser only shows us the address of pages Glide is allowed to run on.
      note('note', `Glide can't run here. Browser pages and the extension store are off-limits to every extension. ` +
        `If this is a normal site or a local file, check Glide's <b>Site access</b> and <b>Allow access to file URLs</b> in <code>${extPage}</code>.`);
    } else if (ownPage) {
      note('note', 'The test area on this page always uses your current settings.');
    } else if (restricted) {
      note('note', 'The browser blocks extensions on this page (browser pages, the extension store).');
    } else if (isFile) {
      if (!(await ask(cb => chrome.extension.isAllowedFileSchemeAccess(cb)))) {
        note('note', `To use it on local files, turn on <b>Allow access to file URLs</b> for Glide in <code>${extPage}</code>.`);
      } else {
        note('note', 'Local files can only be switched off with the master switch.');
      }
    } else {
      $('site').disabled = false;
      $('site').checked = !blocklist.some(entry => hostMatches(host, entry));
    }

    if (!(await ask(cb => chrome.extension.isAllowedIncognitoAccess(cb)))) {
      note('private', `Off in private windows. To use it there, turn on <b>Allow in Private</b> in <code>${extPage}</code>.`);
    }

    $('global').addEventListener('change', e => chrome.storage.sync.set({ enabled: e.target.checked }));

    $('site').addEventListener('change', async e => {
      const cur = (await chrome.storage.sync.get({ blocklist: [] })).blocklist;
      const next = e.target.checked
        ? cur.filter(entry => !hostMatches(host, entry))
        : [...cur, host];
      try {
        await chrome.storage.sync.set({ blocklist: next });
      } catch (_) {
        e.target.checked = !e.target.checked;   // didn't save: don't pretend it did
      }
    });

    $('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  }

  init();
})();
