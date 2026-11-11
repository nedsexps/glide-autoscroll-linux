// Glide Autoscroll — settings page (needs shared.js loaded first).
(() => {
  'use strict';

  const { DEFAULTS, cleanList } = globalThis.GlideShared;
  const TOGGLES = ['enabled', 'fallback', 'skipCanvas', 'showIndicator', 'invert'];
  const SLIDERS = ['speed', 'acceleration', 'deadZone'];
  const SLIDER_SAVE_DELAY = 400;   // ms of quiet before a slider drag is written
  const LIST_SAVE_DELAY = 600;
  const RETRY_DELAY = 5000;
  const $ = id => document.getElementById(id);

  // ---------- test-area content ----------
  function fill(box, count, className, label) {
    for (let i = 1; i <= count; i++) {
      const d = document.createElement('div');
      d.className = className;
      d.textContent = `${label} ${i}`;
      box.appendChild(d);
    }
  }
  fill($('vbox'), 120, 'line', 'Row');
  fill($('hbox'), 30, 'tile', 'Card');

  // ---------- saving ----------
  // Browser sync storage allows ~120 writes a minute, and a slider drag fires an
  // input event per step. Changes apply to the test area instantly and are written
  // once things settle.
  const pendingPatch = {};
  let saveTimer = null;
  let statusTimer = null;

  function showStatus(text, isError) {
    const el = $('saved');
    el.textContent = text;
    el.classList.toggle('err', !!isError);
    el.classList.add('show');
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  // content.js on this page listens for this, so the test area follows the controls live
  function preview(patch) {
    window.dispatchEvent(new CustomEvent('glide-preview', { detail: patch }));
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const patch = { ...pendingPatch };
    for (const k in pendingPatch) delete pendingPatch[k];
    if (!Object.keys(patch).length) return;
    try {
      await chrome.storage.sync.set(patch);
      showStatus('Saved');
    } catch (e) {
      const newer = { ...pendingPatch };
      Object.assign(pendingPatch, patch, newer);   // keep it (newer edits win) and retry shortly
      showStatus(`Not saved yet: ${e.message}`, true);
      saveTimer = setTimeout(flush, RETRY_DELAY);
    }
  }

  function queue(patch, delay) {
    Object.assign(pendingPatch, patch);
    preview(patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, delay);
  }

  // ---------- rendering ----------
  const current = { ...DEFAULTS };

  function labels() {
    $('speedOut').textContent = `${Number(current.speed).toFixed(2)}×`;
    $('accelOut').textContent = Number(current.acceleration).toFixed(2);
    $('dzOut').textContent = `${current.deadZone}px`;
  }

  function checkRadio(name, value, fallback) {
    const radios = [...document.querySelectorAll(`input[name=${name}]`)];
    (radios.find(r => r.value === value) || radios.find(r => r.value === fallback)).checked = true;
  }

  function render(c) {
    Object.assign(current, c);
    const focused = document.activeElement;
    for (const id of TOGGLES) $(id).checked = !!current[id];
    for (const id of SLIDERS) if ($(id) !== focused) $(id).value = current[id];
    checkRadio('mode', current.mode, DEFAULTS.mode);
    checkRadio('links', current.links, DEFAULTS.links);
    if ($('blocklist') !== focused) $('blocklist').value = (current.blocklist || []).join('\n');
    labels();
  }

  // ---------- wiring ----------
  async function init() {
    render(await chrome.storage.sync.get(DEFAULTS));

    for (const id of TOGGLES) {
      $(id).addEventListener('change', e => queue({ [id]: e.target.checked }, 0));
    }
    for (const id of SLIDERS) {
      $(id).addEventListener('input', e => {
        current[id] = Number(e.target.value);
        labels();
        queue({ [id]: current[id] }, SLIDER_SAVE_DELAY);
      });
    }
    for (const name of ['mode', 'links']) {
      document.querySelectorAll(`input[name=${name}]`).forEach(r =>
        r.addEventListener('change', e => queue({ [name]: e.target.value }, 0)));
    }

    $('blocklist').addEventListener('input', e => queue({ blocklist: cleanList(e.target.value) }, LIST_SAVE_DELAY));
    // show the cleaned-up list once you're done editing
    $('blocklist').addEventListener('blur', e => { e.target.value = cleanList(e.target.value).join('\n'); });

    // Resets how it behaves; the list of sites you've switched it off for is yours to keep.
    $('reset').addEventListener('click', () => {
      const { blocklist: _keep, ...behaviour } = DEFAULTS;
      render(behaviour);
      queue(behaviour, 0);
    });

    // Keep in sync if the popup changes something while this page is open
    chrome.storage.onChanged.addListener(async (_changes, area) => {
      if (area === 'sync' && !saveTimer) render(await chrome.storage.sync.get(DEFAULTS));
    });

    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  init();
})();
