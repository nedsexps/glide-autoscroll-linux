// Glide Autoscroll — the one copy of things the content script, settings page and popup all need.
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    speed: 1,            // multiplier on base speed
    acceleration: 1.6,   // exponent: how fast speed ramps with distance
    deadZone: 12,        // px around the start point where nothing moves
    mode: 'both',        // both | sticky | hold
    links: 'open',       // open = middle-click on links opens a tab; scroll = autoscroll anyway
    skipCanvas: true,    // leave canvas (maps, games, editors) alone
    fallback: true,      // clicks outside any scroll area scroll the page's main panel
    invert: false,       // drag-to-move-content instead of direction-of-travel
    showIndicator: true,
    blocklist: Object.freeze([])
  });

  // Turn whatever was typed or pasted ("https://Example.com/page", "*.example.com",
  // "example.com:8080") into a bare hostname. Returns '' for junk.
  function normEntry(raw) {
    let s = String(raw ?? '').trim().toLowerCase();
    if (!s) return '';
    if (s.includes('://')) {
      try { s = new URL(s).hostname; } catch (_) { return ''; }
    }
    return s.replace(/^\*\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  }

  // A blocklist entry covers the host itself and its subdomains.
  function hostMatches(host, entry) {
    const p = normEntry(entry);
    return !!p && (host === p || host.endsWith('.' + p));
  }

  function cleanList(text) {
    return [...new Set(String(text).split(/\s+/).map(normEntry).filter(Boolean))];
  }

  globalThis.GlideShared = Object.freeze({ DEFAULTS, normEntry, hostMatches, cleanList });
})();
