// Glide Autoscroll — middle-click autoscroll engine (content script; needs shared.js loaded first).
//
// How frames cooperate. All positions are client (viewport) coordinates in CSS px; screen
// coordinates are never used, because privacy protections (Brave's, for one) mask them per frame.
//   driver    the frame whose content is scrolling. It owns the overlay and the animation.
//   hand-off  a frame with nothing to scroll passes the press up to its parent, which becomes
//             the driver. Parent <-> child talk by window.postMessage, converting coordinates at
//             each hop using the iframe element's position.
//   tracking  a driver that isn't the top frame tells its ancestors where its viewport sits in
//             theirs, so they can report the pointer once it leaves the driver's iframe. Those
//             reports, and stop requests, travel through the background worker.
// Frame-to-frame messages carry a secret key from extension storage, which page scripts can't
// read, so a page can't fake them.
(() => {
  'use strict';

  // A fresh copy (injected after an install, update or re-enable) replaces any older one here.
  try { window.__glideAutoscroll?.teardown?.(); } catch (_) {}

  const { DEFAULTS, hostMatches } = globalThis.GlideShared;

  // ---------- constants ----------
  const BASE_SPEED = 1000;         // on-screen px/s at 100px past the dead zone, speed 1
  const MAX_SPEED = 30000;
  const EASE_RATE = 14;            // how quickly speed rises to follow the pointer (per second)
  const BRAKE_RATE = 32;           // how quickly it falls when the pointer moves back
  const MAX_FRAME_DT = 0.05;       // a stalled frame never produces a jump bigger than this (s)
  const DRAG_THRESHOLD = 6;        // px moved while held before release counts as a hold-drag
  const HEARTBEAT_MS = 700;        // driver -> other frames: "still gliding"
  const REMOTE_TIMEOUT_MS = 2000;  // other frames give up on a driver that went quiet
  const ASK_INTERVAL_MS = 1000;    // how often an embedded frame re-checks with its parent
  const ANSWER_MIN_GAP_MS = 100;   // per child frame
  const PUSH_INTERVAL_MS = 1000;   // how often a parent re-checks the answers it has given
  const MAX_ASKERS = 64;
  const ASK_RETRY_MS = 1500;
  const PRESS_PAIR_MS = 100;       // pointerdown and its mousedown belong together within this
  const CLICK_TAIL_MS = 60;        // click/auxclick arrive within this of a swallowed mouseup
  const REHOME_EVERY = 15;         // frames between overlay sanity checks
  const MAIN_AREA_MIN = 0.3;       // fallback panel must cover this much of the viewport
  const MIDDLE = 4;                // MouseEvent.buttons bit for the middle button
  const FRAME_MSG = '__glideFrame'; // field that carries the key on parent<->child frame messages
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const SCROLLABLE = /^(auto|scroll|overlay)$/;
  const IS_TOP = window === window.top;
  const FRAME_ID = Math.random().toString(36).slice(2);

  const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime;
  const isExtPage = location.protocol === 'chrome-extension:';
  const domApi = hasChrome && chrome.dom && typeof chrome.dom.openOrClosedShadowRoot === 'function'
    ? chrome.dom : null;

  // ---------- state ----------
  let cfg = { ...DEFAULTS };
  let dead = false;            // this copy has been retired
  let frameKey = null;         // secret that marks genuine frame-to-frame messages
  let zoom = 1;                // page zoom: client px * zoom = on-screen px
  let active = null;           // the glide this frame is driving
  let remote = null;           // { src, seen }: a glide some other frame is driving
  let track = null;            // { id, x, y }: where driver `id`'s viewport sits in ours
  let handoff = null;          // { held, child }: this frame passed a press up to its parent
  let upOk = false;            // our parent said it can take a hand-off from this frame
  let answered = false;        // our parent has answered at least once
  const askers = new Map();    // child window -> { ok, t }: the answer each child frame last got from us
  let lastAsk = -Infinity, lastPush = -Infinity;     // performance.now() times
  let pending = null;          // decision made at pointerdown, reused by its mousedown
  let swallowPointer = false;  // hide the pointerup of a press we consumed
  const swallow = new Map();   // button -> 'down' | 'up': eat the rest of a press we consumed
  let host = null, indicator = null;   // overlay element and its start-point marker
  let frameCache = null;       // { win, el }: last child window -> iframe element lookup
  let queuedReport = null, reportQueued = false;
  let queuedUp = null, upQueued = false;

  // After an extension update/reload/disable, this copy's chrome.runtime.id disappears.
  function alive() {
    if (dead) return false;
    if (!hasChrome) return true;
    try { return !!chrome.runtime.id; } catch (_) { return false; }
  }

  const num = v => (Number.isFinite(+v) ? +v : 0);

  // ---------- listener bookkeeping (so an outdated copy can remove itself) ----------
  const listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  const instance = { teardown: null };   // what a newer copy calls to retire this one

  function teardown() {
    if (dead) return;
    stop();
    dead = true;
    for (const [t, type, fn, opts] of listeners) {
      try { t.removeEventListener(type, fn, opts); } catch (_) {}
    }
    listeners.length = 0;
    try { chrome.storage.onChanged.removeListener(onStorage); } catch (_) {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
    if (window.__glideAutoscroll === instance) {
      try { delete window.__glideAutoscroll; } catch (_) {}
    }
  }
  instance.teardown = teardown;
  window.__glideAutoscroll = instance;

  // ---------- settings ----------
  function onStorage(changes, area) {
    if (!alive()) { teardown(); return; }
    if (area === 'local' && changes.frameKey) setFrameKey(changes.frameKey.newValue);
    if (area !== 'sync') return;
    for (const k in changes) cfg[k] = changes[k].newValue ?? DEFAULTS[k];
    if (!cfg.enabled || isBlocked()) stop();
  }

  function topHost() {
    if (IS_TOP) return location.hostname;
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
    } catch (_) {}
    return location.hostname;
  }

  function isBlocked() {
    const h = (topHost() || '').toLowerCase();
    return (cfg.blocklist || []).some(entry => hostMatches(h, entry));
  }

  // ---------- shadow DOM aware tree walking ----------
  function shadowOf(el) {
    if (el.shadowRoot) return el.shadowRoot;
    if (!domApi) return null;
    try { return domApi.openOrClosedShadowRoot(el) || null; } catch (_) { return null; }
  }

  // Deepest element at a point, looking inside shadow roots (closed ones too).
  function deepElementAt(x, y, from) {
    let el = from || document.elementFromPoint(x, y);
    for (let i = 0; el && i < 32; i++) {
      const sr = shadowOf(el);
      if (!sr) break;
      const inner = sr.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function findSlot(sr, n) {
    try {
      for (const s of sr.querySelectorAll('slot')) if (s.assignedNodes().includes(n)) return s;
    } catch (_) {}
    return null;
  }

  // Parent in the rendered (flat) tree: through slots and out of shadow roots.
  function flatParent(n) {
    const p = n.parentNode;
    if (!p) return null;
    if (p.nodeType === 11) return p.host || null;   // shadow root -> its host
    if (p.nodeType !== 1) return null;              // reached the document
    const sr = shadowOf(p);
    if (sr) {                                       // n is projected into p's shadow tree
      const slot = n.assignedSlot || findSlot(sr, n);
      if (slot) return slot;
    }
    return p;
  }

  function chainFrom(el) {
    const out = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 1024; n = flatParent(n), i++) out.push(n);
    return out;
  }

  // ---------- finding what to scroll ----------
  function rootCanScroll(axis) {
    const se = document.scrollingElement || document.documentElement;
    if (!se || !document.documentElement) return false;
    const prop = axis === 'y' ? 'overflowY' : 'overflowX';
    let ov = getComputedStyle(document.documentElement)[prop];
    if (ov === 'visible' && document.body) ov = getComputedStyle(document.body)[prop];
    if (ov === 'hidden' || ov === 'clip') return false;
    return axis === 'y'
      ? se.scrollHeight > se.clientHeight + 1
      : se.scrollWidth > se.clientWidth + 1;
  }

  function elCanScroll(el, axis) {
    if (el === document.documentElement || el === document.scrollingElement) return false;
    if (el === document.body) {
      // body only scrolls on its own if html isn't the one propagating overflow
      const htmlOv = getComputedStyle(document.documentElement)[axis === 'y' ? 'overflowY' : 'overflowX'];
      if (htmlOv === 'visible') return false;
    }
    const cs = getComputedStyle(el);
    if (!SCROLLABLE.test(axis === 'y' ? cs.overflowY : cs.overflowX)) return false;
    return axis === 'y'
      ? el.scrollHeight > el.clientHeight + 1
      : el.scrollWidth > el.clientWidth + 1;
  }

  // Each axis gets its own target: a horizontal carousel inside a vertically
  // scrolling page scrolls sideways with the carousel and up/down with the page.
  function findTargets(chain) {
    let x = null, y = null;
    for (const n of chain) {
      if (!y && elCanScroll(n, 'y')) y = n;
      if (!x && elCanScroll(n, 'x')) x = n;
      if (x && y) break;
    }
    const root = document.scrollingElement || document.documentElement;
    if (!y && rootCanScroll('y')) y = root;
    if (!x && rootCanScroll('x')) x = root;
    return { x, y };
  }

  // App-style pages: the page itself doesn't scroll, a big panel does. Sample the
  // viewport and pick the largest visible vertical scroller.
  function mainArea() {
    const vw = innerWidth, vh = innerHeight;
    if (vw < 1 || vh < 1) return null;
    const seen = new Set();
    let best = null, bestArea = 0;
    for (const fx of [0.25, 0.5, 0.75]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        for (let n = deepElementAt(fx * vw, fy * vh); n && n.nodeType === 1; n = flatParent(n)) {
          if (seen.has(n)) break;
          seen.add(n);
          if (!elCanScroll(n, 'y')) continue;
          const r = n.getBoundingClientRect();
          const w = Math.min(r.right, vw) - Math.max(r.left, 0);
          const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          const area = w > 0 && h > 0 ? w * h : 0;
          if (area > bestArea) { best = n; bestArea = area; }
        }
      }
    }
    if (!best || bestArea < MAIN_AREA_MIN * vw * vh) return null;
    return { x: elCanScroll(best, 'x') ? best : null, y: best };
  }

  function isExcluded(chain) {
    for (const n of chain) {
      const tag = n.localName;
      if (cfg.links === 'open') {
        if ((tag === 'a' || tag === 'area') && n.hasAttribute('href')) return true;
        if (n.getAttribute('role') === 'link') return true;
      }
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true;
      if (n.isContentEditable) return true;
      if (tag === 'video' || tag === 'audio' || tag === 'embed' || tag === 'object') return true;
      if (cfg.skipCanvas && tag === 'canvas') return true;
    }
    return false;
  }

  // Middle-clicking a scrollbar has its own meaning on Linux (jump to that spot).
  function onScrollbar(e, el) {
    const vp = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
    if (vp) {
      if (innerWidth > vp.clientWidth && e.clientX >= vp.clientWidth) return true;
      if (innerHeight > vp.clientHeight && e.clientY >= vp.clientHeight) return true;
    }
    if (!el || el === document.documentElement || el === document.body) return false;
    const cs = getComputedStyle(el);
    if (!SCROLLABLE.test(cs.overflowX) && !SCROLLABLE.test(cs.overflowY)) return false;
    const r = el.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
    const sbw = el.offsetWidth - el.clientWidth - bl - br;
    const sbh = el.offsetHeight - el.clientHeight - bt - bb;
    if (sbw > 1) {
      const leftSide = el.clientLeft > bl + 0.5;   // RTL puts the scrollbar on the left
      const x0 = leftSide ? r.left + bl : r.left + bl + el.clientWidth;
      if (e.clientX >= x0 && e.clientX < x0 + sbw && e.clientY >= r.top + bt && e.clientY < r.bottom - bb) return true;
    }
    if (sbh > 1) {
      const y0 = r.top + bt + el.clientHeight;
      if (e.clientY >= y0 && e.clientY < y0 + sbh && e.clientX >= r.left + bl && e.clientX < r.right - br) return true;
    }
    return false;
  }

  // What a press at the bottom of `chain` should do in this frame:
  //   { kind: 'local', t }  scroll something here
  //   { kind: 'handoff' }   nothing here, but the parent has said it can take it
  //   null                  leave the click alone
  function pick(chain) {
    let t = findTargets(chain);
    if (!t.x && !t.y && cfg.fallback) t = mainArea() || t;
    if (t.x || t.y) return { kind: 'local', t };
    if (!IS_TOP && upOk) return { kind: 'handoff' };
    return null;
  }

  function decide(e) {
    if (e.button !== 1) return null;
    if (!cfg.enabled || isBlocked()) return null;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return null; // leave modified clicks to the browser
    const first = e.composedPath().find(n => n && n.nodeType === 1);
    if (!first) return null;
    const target = deepElementAt(e.clientX, e.clientY, first);
    const chain = chainFrom(target);
    if (isExcluded(chain)) return null;
    if (onScrollbar(e, target)) return null;
    return pick(chain);
  }

  // ---------- messages through the background worker (trusted: pages can't send these) ----------
  function relay(msg) {
    if (!hasChrome || !alive()) return;
    try { chrome.runtime.sendMessage({ __glide: true, src: FRAME_ID, ...msg }).catch(() => {}); } catch (_) {}
  }

  function liveRemote() {
    if (remote && performance.now() - remote.seen > REMOTE_TIMEOUT_MS) remote = null; // driver vanished
    return !!remote;
  }

  function stopRemote() {
    relay({ type: 'stop' });
    remote = null;
  }

  function onRuntimeMessage(msg, sender, sendResponse) {
    if (!alive()) { teardown(); return; }
    if (!msg || msg.__glide !== true) return;
    if (sender && sender.tab) return;          // only our background worker, never another tab
    if (msg.type === 'ping') { sendResponse(true); return; }
    if (msg.src === FRAME_ID) return;          // our own message coming back round
    switch (msg.type) {
      case 'started': remote = { src: msg.src, seen: performance.now() }; break;
      case 'alive': if (remote && remote.src === msg.src) remote.seen = performance.now(); break;
      case 'stopped': if (remote && remote.src === msg.src) remote = null; break;
      case 'move': if (active && msg.to === FRAME_ID) setPointer(msg.x, msg.y); break;
      case 'stop': if (active) stop(); break;
      case 'zoom': if (msg.zoom > 0) zoom = msg.zoom; break;
    }
  }

  function requestZoom() {
    if (!hasChrome || !alive()) return;
    try {
      chrome.runtime.sendMessage({ __glide: true, type: 'zoom?' })
        .then(z => { if (typeof z === 'number' && z > 0) zoom = z; })
        .catch(() => {});
    } catch (_) {}
  }

  // While another frame drives, the pointer turned up in this frame at client (cx, cy).
  function reportPointer(cx, cy) {
    queuedReport = { cx, cy };
    if (reportQueued) return;
    reportQueued = true;
    requestAnimationFrame(() => {
      reportQueued = false;
      const p = queuedReport;
      if (!p || !liveRemote()) return;
      if (track && track.id === remote.src) {
        // we know where the driver's viewport is: hand it the position in its own coordinates
        relay({ type: 'move', to: remote.src, x: p.cx - track.x, y: p.cy - track.y });
      } else {
        postUp({ type: 'pos', id: remote.src, cx: p.cx, cy: p.cy });   // an ancestor will know
      }
    });
  }

  // ---------- messages between a frame and its parent (window.postMessage) ----------
  function postUp(msg) {
    if (!IS_TOP) postTo(window.parent, msg);
  }

  function postTo(win, msg) {
    if (!frameKey) return;      // not loaded yet: frames simply don't cooperate for a moment
    try { win.postMessage({ [FRAME_MSG]: frameKey, ...msg }, '*'); } catch (_) {}
  }

  function queueUp(cx, cy) {
    queuedUp = { cx, cy };
    if (upQueued) return;
    upQueued = true;
    requestAnimationFrame(() => {
      upQueued = false;
      if (handoff && queuedUp) postUp({ type: 'move', ...queuedUp });
    });
  }

  function searchFrames(root, win) {
    for (const f of root.querySelectorAll('iframe,frame')) if (f.contentWindow === win) return f;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);   // frames inside shadow roots
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const sr = shadowOf(n);
      if (!sr) continue;
      const found = searchFrames(sr, win);
      if (found) return found;
    }
    return null;
  }

  // The <iframe> element in this document that hosts child window `win`, if any.
  function frameElementFor(win) {
    if (!win || win === window) return null;
    const c = frameCache;
    if (c && c.win === win && c.el.isConnected && c.el.contentWindow === win) return c.el;
    const el = searchFrames(document, win);
    frameCache = el ? { win, el } : null;
    return el;
  }

  // Top-left corner of a child frame's viewport, in this frame's client coordinates.
  function frameOrigin(frameEl) {
    const r = frameEl.getBoundingClientRect();
    const cs = getComputedStyle(frameEl);
    return {
      x: r.left + frameEl.clientLeft + (parseFloat(cs.paddingLeft) || 0),
      y: r.top + frameEl.clientTop + (parseFloat(cs.paddingTop) || 0)
    };
  }

  // An embedded frame needs to know ahead of time whether its parent could take a press it
  // can't use itself: the decision to swallow a click can't wait for a reply. So each frame
  // checks in with its parent as soon as it can talk, again whenever the mouse is active in
  // it, and the parent sends word if its answer changes. Without a "yes" on file a frame
  // leaves such clicks alone instead of eating them.
  function askUp(force) {
    if (IS_TOP || !cfg.enabled || isBlocked()) return;
    const now = performance.now();
    if (!force && now - lastAsk < ASK_INTERVAL_MS) return;
    lastAsk = now;
    postUp({ type: 'ask' });
  }

  function setFrameKey(key) {
    frameKey = typeof key === 'string' && key ? key : null;
    if (!frameKey || IS_TOP) return;
    askUp(true);
    // the parent's copy may not have been ready to hear that; try once more if it stays silent
    setTimeout(() => { if (!answered && alive()) askUp(true); }, ASK_RETRY_MS);
  }

  function canTakeFrom(frameEl) {
    return cfg.enabled && !isBlocked() && !!pick(chainFrom(frameEl));
  }

  function answerAsk(src, frameEl) {
    const now = performance.now();
    const rec = askers.get(src);
    if (rec && now - rec.t < ANSWER_MIN_GAP_MS) return;
    if (!rec && askers.size >= MAX_ASKERS) askers.delete(askers.keys().next().value);
    const ok = canTakeFrom(frameEl);
    askers.set(src, { ok, t: now });
    postTo(src, { type: 'answer', ok });
  }

  // Tell child frames whose answer has changed. onlyRefused: just re-check the ones we
  // turned down (the cheap, common case: the page has become scrollable since).
  function pushAnswers(onlyRefused) {
    for (const [win, rec] of askers) {
      if (onlyRefused && rec.ok) continue;
      const el = frameElementFor(win);
      if (!el) { askers.delete(win); continue; }
      const ok = canTakeFrom(el);
      if (ok === rec.ok) continue;
      rec.ok = ok;
      postTo(win, { type: 'answer', ok });
    }
  }

  function onScroll() {
    if (!askers.size) return;
    const now = performance.now();
    if (now - lastPush < PUSH_INTERVAL_MS) return;
    lastPush = now;
    pushAnswers(true);
  }

  function acceptHandoff(d, source, frameEl) {
    if (active || !cfg.enabled || isBlocked()) return;
    // Must follow a real click: user activation propagates up from the clicked frame.
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    const decision = pick(chainFrom(frameEl));
    if (!decision) return;
    const o = frameOrigin(frameEl);
    const cx = o.x + num(d.cx), cy = o.y + num(d.cy);
    const held = d.held === true;
    // The middle release may land in this frame; eat it (and stop it pasting).
    if (held) { swallow.set(1, 'down'); swallowPointer = true; }
    if (decision.kind === 'handoff') {          // nothing here either: pass it further up
      handoff = { held, child: source };
      postUp({ type: 'handoff', cx, cy, held });
      return;
    }
    start(decision.t, { cx, cy, held, source });
  }

  function onWindowMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || !(FRAME_MSG in d)) return;
    e.stopImmediatePropagation();               // keep it away from the page's own listeners
    if (!alive()) { teardown(); return; }
    if (!frameKey || d[FRAME_MSG] !== frameKey) return;   // not from one of our own copies
    const src = e.source;
    if (!src) return;

    if (!IS_TOP && src === window.parent) {     // from the frame above: only ever an answer
      if (d.type !== 'answer') return;
      upOk = d.ok === true;
      answered = true;
      pushAnswers(false);                       // what we can take from our own children may have changed
      return;
    }

    const frameEl = frameElementFor(src);       // everything else must come from our own child frames
    if (!frameEl) return;
    switch (d.type) {
      case 'ask':
        answerAsk(src, frameEl);
        askUp();                                 // keep our own answer from above fresh too
        break;
      case 'handoff':
        acceptHandoff(d, src, frameEl);
        break;
      case 'move': {                             // pointer still captured by the frame that was clicked
        const o = frameOrigin(frameEl);
        const cx = o.x + num(d.cx), cy = o.y + num(d.cy);
        if (active && active.source === src) setPointer(cx, cy);
        else if (handoff && handoff.child === src) postUp({ type: 'move', cx, cy });
        break;
      }
      case 'up':                                 // the release landed (and was eaten) in the child frame
        if (active && active.source === src) {
          if (swallow.get(1) === 'down') swallow.delete(1);
          swallowPointer = false;
          releaseHeld();
        } else if (handoff && handoff.child === src) {
          if (swallow.get(1) === 'down') swallow.delete(1);
          swallowPointer = false;
          postUp({ type: 'up' });
          handoff = null;
        }
        break;
      case 'track': {                            // a driver below us announces itself
        if (typeof d.id !== 'string') break;
        const o = frameOrigin(frameEl);
        track = { id: d.id, x: o.x + num(d.x), y: o.y + num(d.y) };
        postUp({ type: 'track', id: track.id, x: track.x, y: track.y });
        break;
      }
      case 'pos': {                              // a frame below saw the pointer and couldn't place it
        const o = frameOrigin(frameEl);
        const cx = o.x + num(d.cx), cy = o.y + num(d.cy);
        if (active && d.id === FRAME_ID) setPointer(cx, cy);
        else if (liveRemote() && remote.src === d.id) reportPointer(cx, cy);
        break;
      }
    }
  }

  // ---------- overlay + indicator ----------
  const ARROW = (d, lit) => {
    const pts = {
      n: '20,8 15,14 25,14', s: '20,32 15,26 25,26',
      w: '8,20 14,15 14,25', e: '32,20 26,15 26,25'
    }[d];
    return `<polygon points="${pts}" class="${lit ? 'on' : 'off'}"/>`;
  };

  function overlayParent() {
    // While a site's modal <dialog> is open, everything outside it is inert, so the
    // overlay has to live inside the topmost one to receive the mouse.
    try {
      const modals = document.querySelectorAll('dialog:modal');
      if (modals.length) return modals[modals.length - 1];
    } catch (_) {}
    return document.documentElement || document.body;
  }

  function showOverlay(cx, cy, hasX, hasY) {
    const parent = overlayParent();
    if (!parent) return;
    host = document.createElementNS(XHTML, 'glide-autoscroll-overlay');
    host.setAttribute('popover', 'manual');
    host.style.cssText = [
      'all:initial', 'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
      'margin:0', 'padding:0', 'border:0', 'background:transparent', 'overflow:hidden',
      'z-index:2147483647', 'display:block', 'pointer-events:auto', 'cursor:all-scroll'
    ].map(s => s + ' !important').join(';');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .ind {
          position: fixed; left: ${cx - 20}px; top: ${cy - 20}px;
          width: 40px; height: 40px; pointer-events: none;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,.35));
          opacity: 0; transform: scale(.7);
          transition: opacity .12s ease-out, transform .12s ease-out;
        }
        .ind.in { opacity: 1; transform: scale(1); }
        circle.ring { fill: rgba(255,255,255,.92); stroke: rgba(20,20,24,.55); stroke-width: 1.25; }
        circle.dot { fill: #141418; }
        .on { fill: #141418; }
        .off { fill: rgba(20,20,24,.18); }
      </style>
      ${cfg.showIndicator ? `<svg class="ind" viewBox="0 0 40 40">
        <circle class="ring" cx="20" cy="20" r="17"/>
        <circle class="dot" cx="20" cy="20" r="2.25"/>
        ${ARROW('n', hasY)}${ARROW('s', hasY)}${ARROW('w', hasX)}${ARROW('e', hasX)}
      </svg>` : ''}`;
    indicator = shadow.querySelector('.ind');
    parent.appendChild(host);
    // Popover puts us in the top layer, above modal dialogs and fullscreen elements.
    try { host.showPopover(); } catch (_) {}
    if (indicator) requestAnimationFrame(() => indicator && indicator.classList.add('in'));
  }

  function hideOverlay() {
    if (host) {
      try { host.hidePopover(); } catch (_) {}
      host.remove();
    }
    host = indicator = null;
  }

  // The overlay can be taken out from under us (its dialog closes, the page rebuilds itself)
  // or end up in the wrong place (a modal opens mid-glide). Put it back where it works.
  function rehomeOverlay(a) {
    if (!host) return;
    if (host.isConnected && host.parentNode === overlayParent()) return;
    hideOverlay();
    try { showOverlay(a.cx, a.cy, !!a.tx, !!a.ty); } catch (_) { hideOverlay(); }
    a.cursor = '';
  }

  // sdx/sdy: pointer offset from the start point in on-screen px
  function setCursor(sdx, sdy, a) {
    if (!host) return;
    const dz = cfg.deadZone;
    let v = '', h = '';
    if (a.ty) { if (sdy < -dz) v = 'n'; else if (sdy > dz) v = 's'; }
    if (a.tx) { if (sdx < -dz) h = 'w'; else if (sdx > dz) h = 'e'; }
    let c;
    if (v || h) c = v + h + '-resize';
    else c = a.tx && a.ty ? 'all-scroll' : a.ty ? 'ns-resize' : 'ew-resize';
    if (c !== a.cursor) {
      a.cursor = c;
      host.style.setProperty('cursor', c, 'important');
    }
  }

  // ---------- scroll-snap: suspend while gliding, or it fights every step ----------
  function suspendSnap(el, a) {
    if (!el || a.snaps.some(s => s.el === el)) return;
    a.snaps.push({
      el,
      val: el.style.getPropertyValue('scroll-snap-type'),
      pri: el.style.getPropertyPriority('scroll-snap-type')
    });
    el.style.setProperty('scroll-snap-type', 'none', 'important');
  }

  function restoreSnaps(a) {
    for (const s of a.snaps) {
      if (s.val) s.el.style.setProperty('scroll-snap-type', s.val, s.pri);
      else s.el.style.removeProperty('scroll-snap-type');
    }
  }

  // ---------- engine ----------
  // Scroll speed (CSS px/s) for a pointer offset of d CSS px from the start point.
  function velocity(d) {
    const excess = Math.abs(d) * zoom - cfg.deadZone;   // on-screen px past the dead zone
    if (excess <= 0) return 0;
    const v = BASE_SPEED * cfg.speed * Math.pow(excess / 100, cfg.acceleration);
    // Divided by page zoom so the content moves at the same on-screen speed at any zoom.
    return Math.sign(d) * Math.min(v, MAX_SPEED) / zoom * (cfg.invert ? -1 : 1);
  }

  // Track the exact (fractional) position ourselves instead of adding rounded steps,
  // so speed is right at 125%/150% display scaling.
  function applyAxis(el, st, v, dt, horizontal, tolerance) {
    if (!el) return;
    const cur = horizontal ? el.scrollLeft : el.scrollTop;
    // Something else moved it (the page, scroll anchoring): carry on from where it is now.
    if (st.set === null || Math.abs(cur - st.set) > 0.01) st.pos = cur;
    if (!v) { st.set = cur; st.pos = cur; return; }
    st.pos += v * dt;
    // 'instant' overrides sites that set scroll-behavior: smooth, which otherwise
    // turns every frame into a laggy mini-animation.
    el.scrollTo(horizontal ? { left: st.pos, behavior: 'instant' } : { top: st.pos, behavior: 'instant' });
    const got = horizontal ? el.scrollLeft : el.scrollTop;
    // The browser decides where the range ends (it runs negative in bottom-up and
    // right-to-left boxes). Past the end, fall back to where it actually stopped.
    if (Math.abs(got - st.pos) > tolerance) st.pos = got;
    st.set = got;
  }

  // Speeding up follows the pointer gently; slowing down or reversing is quicker, so the
  // page stops promptly when the pointer goes back to the start point.
  function ease(v, target, dt) {
    const braking = Math.abs(target) < Math.abs(v) || target * v < 0;
    return v + (target - v) * Math.min(1, dt * (braking ? BRAKE_RATE : EASE_RATE));
  }

  function tick(now) {
    const a = active;
    if (!a) return;
    // What we were scrolling can vanish mid-glide (a dialog closes, the site swaps its page).
    if (a.tx && !a.tx.isConnected) a.tx = null;
    if (a.ty && !a.ty.isConnected) a.ty = null;
    if (!a.tx && !a.ty) { stop(); return; }
    if (++a.frames % REHOME_EVERY === 0) rehomeOverlay(a);

    const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - a.last) / 1000));
    a.last = now;
    const dx = a.mx - a.ox, dy = a.my - a.oy;
    const tvx = a.tx ? velocity(dx) : 0;
    const tvy = a.ty ? velocity(dy) : 0;
    // Ease toward the target speed so mouse jitter doesn't make the page shudder.
    a.vx = ease(a.vx, tvx, dt);
    a.vy = ease(a.vy, tvy, dt);
    if (!tvx && Math.abs(a.vx) < 2) a.vx = 0;
    if (!tvy && Math.abs(a.vy) < 2) a.vy = 0;
    const tol = 0.5 + 1 / (window.devicePixelRatio || 1);
    applyAxis(a.tx, a.sx, a.vx, dt, true, tol);
    applyAxis(a.ty, a.sy, a.vy, dt, false, tol);
    setCursor(dx * zoom, dy * zoom, a);
    if (now - a.ping > HEARTBEAT_MS) { a.ping = now; relay({ type: 'alive' }); }
    a.raf = requestAnimationFrame(tick);
  }

  // t: { x, y } scroll targets. o: { cx, cy } start point in this frame's client coordinates,
  // held: middle button still down, source: child window the press was handed up from.
  function start(t, o) {
    stop();
    const now = performance.now();
    active = {
      tx: t.x, ty: t.y,
      cx: o.cx, cy: o.cy,
      ox: o.cx, oy: o.cy, mx: o.cx, my: o.cy,
      vx: 0, vy: 0,
      sx: { pos: 0, set: null }, sy: { pos: 0, set: null },
      last: now, ping: now, frames: 0, held: !!o.held, moved: false,
      snaps: [], cursor: '', raf: 0, source: o.source || null
    };
    suspendSnap(t.x, active);
    suspendSnap(t.y, active);
    try { showOverlay(o.cx, o.cy, !!t.x, !!t.y); } catch (_) { hideOverlay(); }
    relay({ type: 'started' });                              // other frames: forward keys and clicks
    postUp({ type: 'track', id: FRAME_ID, x: 0, y: 0 });     // ancestors: here's where I am
    requestZoom();
    active.raf = requestAnimationFrame(tick);
  }

  function stop() {
    const a = active;
    if (!a) return;
    active = null;
    cancelAnimationFrame(a.raf);
    restoreSnaps(a);
    hideOverlay();
    relay({ type: 'stopped' });
  }

  // Pointer is now at (x, y) in this frame's client coordinates.
  function setPointer(x, y) {
    const a = active;
    if (!a || !Number.isFinite(x) || !Number.isFinite(y)) return;
    a.mx = x;
    a.my = y;
    if (a.held && !a.moved &&
        Math.hypot(x - a.ox, y - a.oy) * zoom > Math.max(cfg.deadZone, DRAG_THRESHOLD)) a.moved = true;
  }

  function releaseHeld() {
    const a = active;
    if (!a || !a.held) return;
    a.held = false;
    if (cfg.mode === 'hold' || (cfg.mode === 'both' && a.moved)) stop();
  }

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ---------- input (real user input only: pages can't steer this with made-up events) ----------
  function onPointerDown(e) {
    if (!e.isTrusted || e.pointerType !== 'mouse') return;
    if (!alive()) { teardown(); return; }
    pending = null;
    // Hide presses we're going to consume from the page's pointer handlers too.
    if (active || liveRemote()) { e.stopImmediatePropagation(); swallowPointer = true; return; }
    swallowPointer = false;       // a fresh press clears anything left over
    if (e.button !== 1) return;
    askUp();
    const d = decide(e);
    pending = { d, ts: e.timeStamp };
    if (d) { e.stopImmediatePropagation(); swallowPointer = true; }
  }

  function onPointerUp(e) {
    if (!e.isTrusted || e.pointerType !== 'mouse' || !swallowPointer) return;
    swallowPointer = false;
    e.stopImmediatePropagation();
  }

  function onMouseDown(e) {
    if (!e.isTrusted) return;
    if (!alive()) {
      if (active) { consume(e); stop(); }
      teardown();
      return;
    }
    if (active) {                 // any click ends a sticky glide
      consume(e);
      swallow.set(e.button, 'down');
      stop();
      return;
    }
    if (liveRemote()) {           // a glide is running in another frame
      consume(e);
      swallow.set(e.button, 'down');
      stopRemote();
      return;
    }
    swallow.delete(e.button);     // a fresh press ends any leftovers for this button
    if (e.button !== 1) { pending = null; return; }
    handoff = null;
    const d = pending && Math.abs(e.timeStamp - pending.ts) < PRESS_PAIR_MS ? pending.d : decide(e);
    pending = null;
    if (!d) return;               // normal middle click
    consume(e);
    swallow.set(1, 'down');
    if (d.kind === 'local') {
      start(d.t, { cx: e.clientX, cy: e.clientY, held: true });
    } else {
      handoff = { held: true, child: null };
      postUp({ type: 'handoff', cx: e.clientX, cy: e.clientY, held: true });
    }
  }

  function onMouseUp(e) {
    if (!e.isTrusted) return;
    if (swallow.has(e.button)) {
      // Cancelling mouseup is what stops Linux middle-click paste.
      consume(e);
      const b = e.button;
      swallow.set(b, 'up');       // keep eating the click/auxclick that follows
      setTimeout(() => { if (swallow.get(b) === 'up') swallow.delete(b); }, CLICK_TAIL_MS);
    }
    if (e.button === 1) {
      if (active) releaseHeld();
      if (handoff && handoff.held) { postUp({ type: 'up' }); handoff = null; }
    }
  }

  function onClickish(e) {
    if (e.isTrusted && swallow.has(e.button)) consume(e);
  }

  function onContextMenu(e) {
    if (e.isTrusted && swallow.has(2)) consume(e);   // Linux fires contextmenu right after the right mousedown
  }

  function onMouseMove(e) {
    if (!e.isTrusted) return;
    if (active) {
      setPointer(e.clientX, e.clientY);
      // The release can land somewhere we never hear about; the buttons state tells us.
      if (active && active.held && !(e.buttons & MIDDLE)) releaseHeld();
    } else if (handoff && handoff.held) {
      if (!(e.buttons & MIDDLE)) { postUp({ type: 'up' }); handoff = null; }
      else queueUp(e.clientX, e.clientY);
    } else if (liveRemote()) {
      reportPointer(e.clientX, e.clientY);
    } else {
      askUp();
    }
  }

  function onMouseOver(e) {
    // also fires when the page loads or changes under a mouse that isn't moving
    if (e.isTrusted && !active && !handoff && !remote) askUp();
  }

  function onKeyDown(e) {
    if (!e.isTrusted) return;
    if (active) {
      if (e.key === 'Escape') consume(e);
      stop();
    } else if (liveRemote()) {
      if (e.key === 'Escape') consume(e);
      stopRemote();
    }
  }

  function onWheel(e) {
    if (!e.isTrusted) return;
    if (active) stop();
    else if (liveRemote()) stopRemote();
  }

  function onBlur() {
    if (active) stop();
    else if (liveRemote()) stopRemote();
  }

  function onHidden() {
    stop();
    handoff = null;
  }

  // ---------- wiring ----------
  if (hasChrome) {
    try {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
      chrome.storage.sync.get(DEFAULTS).then(v => { cfg = { ...DEFAULTS, ...v }; }).catch(() => {});
      chrome.storage.local.get('frameKey')
        .then(v => setFrameKey(v.frameKey)).catch(() => {});
      chrome.storage.onChanged.addListener(onStorage);
    } catch (_) {}
  }
  // The settings page tunes sliders live without waiting for a save.
  if (isExtPage) {
    on(window, 'glide-preview', e => {
      if (e.detail && typeof e.detail === 'object') Object.assign(cfg, e.detail);
    });
  }

  const capture = { capture: true };
  const watch = { capture: true, passive: true };
  on(window, 'pointerdown', onPointerDown, capture);
  on(window, 'pointerup', onPointerUp, capture);
  on(window, 'mousedown', onMouseDown, capture);
  on(window, 'mouseup', onMouseUp, capture);
  on(window, 'click', onClickish, capture);
  on(window, 'auxclick', onClickish, capture);
  on(window, 'contextmenu', onContextMenu, capture);
  on(window, 'keydown', onKeyDown, capture);
  on(window, 'message', onWindowMessage, capture);
  on(window, 'mousemove', onMouseMove, watch);
  on(window, 'mouseover', onMouseOver, watch);
  on(window, 'wheel', onWheel, watch);
  on(window, 'blur', onBlur);
  on(window, 'pagehide', onHidden);
  on(window, 'load', () => pushAnswers(true));
  on(document, 'scroll', onScroll, watch);
  on(document, 'visibilitychange', () => { if (document.hidden) onHidden(); });
})();
