// Regression tests for the fixes made in v1.1: display scaling, zoom, chorded clicks,
// hidden pointer events, modal dialogs, embeds, app-style pages, scrollbars, shadow DOM.
import { launch, suite, sleep, shot, B } from './lib.mjs';

const { check, finish } = suite('fixes 1.1', 240000);
const browser = await launch({ scrollbars: true });
const sw = await browser.waitForTarget(t => t.type() === 'service_worker');
const worker = await sw.worker();
const extId = new URL(sw.url()).host;
const setCfg = o => worker.evaluate(o => chrome.storage.sync.set(o), o);
const overlayIn = p => p.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
const errors = [];
const open = async (url, opts = {}) => {
  const p = await browser.newPage();
  if (opts.dsf) await p.setViewport({ width: 1200, height: 900, deviceScaleFactor: opts.dsf });
  p.on('pageerror', e => errors.push(`${url}: ${e.message}`));
  await p.goto(url); await sleep(opts.wait ?? 400);
  return p;
};
// arrive, then press, the way a person does (an embed checks with its page as the pointer enters)
const midClick = async (p, x, y) => { await p.mouse.move(x, y); await sleep(80); await p.mouse.down({ button: 'middle' }); await p.mouse.up({ button: 'middle' }); };
const rateOf = (p, expr) => p.evaluate(expr => new Promise(res => {
  const el = eval(expr); const t0 = performance.now(), s0 = el.scrollTop;
  setTimeout(() => res((el.scrollTop - s0) / ((performance.now() - t0) / 1000)), 1500);
}), expr);
const expected = ex => 1000 * Math.pow(ex / 100, 1.6);

// --- 2. speed at fractional display scaling ---
for (const dsf of [1, 1.25, 1.5]) {
  for (const ex of [8, 30]) {
    const p = await open(`${B}/test.html`, { dsf });
    await midClick(p, 170, 120); await p.mouse.move(170, 120 + 12 + ex); await sleep(500);
    const r = await rateOf(p, "document.getElementById('v')");
    const pct = r / expected(ex) * 100;
    check(`speed exact at ${dsf * 100}% scaling, offset ${ex}`, Math.abs(pct - 100) <= 6, `${pct.toFixed(0)}% of target`);
    await p.keyboard.press('Escape'); await p.close();
  }
}

// --- page zoom: same on-screen speed at 200% ---
{
  const p = await open(`${B}/test.html`);
  const zoomTab = z => worker.evaluate(async z => { const [t] = await chrome.tabs.query({ url: 'http://127.0.0.1:8123/test.html' }); await chrome.tabs.setZoomSettings(t.id, { scope: 'per-tab' }); await chrome.tabs.setZoom(t.id, z); }, z);
  await zoomTab(2); await sleep(500);
  // mouse coordinates are CSS px here: 21 CSS px = 42 screen px = dead zone 12 + 30
  await midClick(p, 85, 60); await p.mouse.move(85, 60 + 21); await sleep(500);
  const r = await rateOf(p, "document.getElementById('v')");
  const pct = r / (expected(30) / 2) * 100;
  check('page zoom 200%: same on-screen speed as 100%', Math.abs(pct - 100) <= 8, `${pct.toFixed(0)}% of target`);
  await p.keyboard.press('Escape'); await zoomTab(1); await p.close();
}

// --- 4. dead zone 0 + 1px wobble keeps click-to-toggle ---
const pr = await open(`${B}/probe.html`, { wait: 600 });
const m = pr.mouse;
const ev = () => pr.evaluate(() => { const e = window.events; window.events = []; return e; });
await setCfg({ deadZone: 0 }); await sleep(150);
await m.move(300, 100); await m.down({ button: 'middle' }); await m.move(301, 100); await sleep(250); await m.up({ button: 'middle' });
check('dead zone 0: wobbly click still toggles on', await overlayIn(pr));
await pr.keyboard.press('Escape');
await setCfg({ deadZone: 12 }); await sleep(150); await ev();

// --- 1. chorded release is fully eaten ---
await m.move(300, 100); await m.down({ button: 'middle' }); await sleep(50);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(30); await m.up({ button: 'middle' }); await sleep(80);
let e1 = await ev();
check('hold middle + tap left: page sees nothing', e1.length === 0, JSON.stringify(e1));

// --- 6. pointer events hidden ---
await midClick(pr, 300, 100); await sleep(50);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(80);
e1 = await ev();
check('start + stop clicks invisible to page (pointer events too)', e1.length === 0, JSON.stringify(e1));

// --- 9. modal dialog ---
await pr.evaluate(() => document.getElementById('dlg').showModal()); await sleep(100);
const dr = await pr.evaluate(() => { const r = document.getElementById('dv').getBoundingClientRect(); return { x: r.x + 100, y: r.y + 50 }; });
await midClick(pr, dr.x, dr.y); await m.move(dr.x, dr.y + 80); await sleep(400);
const mt = await pr.evaluate(() => lastMoveTarget);
const dv = await pr.evaluate(() => document.getElementById('dv').scrollTop);
check('modal open: scroller glides + overlay gets the mouse', dv > 50 && mt === 'glide-autoscroll-overlay', `dv=${dv} target=${mt}`);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(60);
check('modal: stop click eaten, dialog still open', !(await overlayIn(pr)) && await pr.evaluate(() => dlg.open), JSON.stringify(await ev()));
await pr.evaluate(() => dlg.close());

// --- 7. hand-off from an embed with nothing to scroll ---
await pr.evaluate(() => scrollTo(0, 0)); await ev();
await midClick(pr, 200, 380); await sleep(150);
check('embed click: glide starts on the page around it', await overlayIn(pr));
await m.move(200, 520); await sleep(500);
const sy = await pr.evaluate(() => scrollY);
check('embed click: page scrolls', sy > 100, `scrollY=${sy}`);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(80);
e1 = await ev();
check('embed click: stops on click, page saw nothing', !(await overlayIn(pr)) && e1.length === 0, JSON.stringify(e1));
// hold-drag variant
await pr.evaluate(() => scrollTo(0, 0)); await sleep(50);
await m.move(200, 380); await sleep(80); await m.down({ button: 'middle' }); await m.move(200, 560, { steps: 6 }); await sleep(400);
const sy2 = await pr.evaluate(() => scrollY);
await m.up({ button: 'middle' }); await sleep(120);
check('embed hold-drag: scrolls and stops on release', sy2 > 100 && !(await overlayIn(pr)), `scrollY=${sy2}`);
e1 = await ev();
check('embed hold-drag: page saw nothing', e1.length === 0, JSON.stringify(e1));

// nested embeds: top > A (cross-origin, fits) > B (fits)
const nt = await open(`${B}/nesttop.html`, { wait: 900 });
const fB = nt.frames().find(f => f.url().includes('fit.html'));
const bb = await nt.evaluate(() => { const r = document.getElementById('a').getBoundingClientRect(); return { x: r.x, y: r.y }; });
await midClick(nt, bb.x + 60, bb.y + 70); await sleep(150);
await nt.mouse.move(bb.x + 60, bb.y + 250); await sleep(500);
const nsy = await nt.evaluate(() => scrollY);
check('nested embeds (2 levels): top page scrolls', nsy > 100 && !!fB, `scrollY=${nsy}`);
await nt.mouse.down({ button: 'left' }); await nt.mouse.up({ button: 'left' }); await sleep(80);
check('nested embeds: stops cleanly', !(await overlayIn(nt)), JSON.stringify(await nt.evaluate(() => events)));
await nt.close();

// --- 8. app-style page: main panel from the sidebar ---
const spa = await open(`${B}/spa.html`);
await midClick(spa, 100, 400); await spa.mouse.move(100, 550); await sleep(500);
const ms = await spa.evaluate(() => main.scrollTop);
check('app page: sidebar click scrolls the main panel', ms > 100, `main.scrollTop=${ms}`);
await spa.keyboard.press('Escape'); await spa.close();
const so = await open(`${B}/smallonly.html`);
await midClick(so, 200, 600); await sleep(100);
check('fallback ignores small widgets', !(await overlayIn(so)));
await so.close();
await setCfg({ fallback: false }); await sleep(150);
const spa2 = await open(`${B}/spa.html`);
await midClick(spa2, 100, 400); await sleep(100);
check('fallback can be switched off', !(await overlayIn(spa2)));
await spa2.close();
await setCfg({ fallback: true }); await sleep(150);

// --- 10. scrollbars left alone ---
const sb = await open(`${B}/test.html`);
const vr = await sb.evaluate(() => { const v = document.getElementById('v'); const r = v.getBoundingClientRect(); return { x: r.right - 1 - (v.offsetWidth - v.clientWidth - 2) / 2, y: r.top + 60, sbw: v.offsetWidth - v.clientWidth - 2 }; });
await midClick(sb, vr.x, vr.y); await sleep(100);
check('middle-click on an element scrollbar: left to the browser', vr.sbw > 0 && !(await overlayIn(sb)), `scrollbar width=${vr.sbw}`);
const pw = await sb.evaluate(() => ({ w: innerWidth, cw: document.documentElement.clientWidth }));
await midClick(sb, pw.cw + (pw.w - pw.cw) / 2, 450); await sleep(100);
check('middle-click on the page scrollbar: left to the browser', pw.w > pw.cw && !(await overlayIn(sb)), `bar=${pw.w - pw.cw}px`);
await midClick(sb, 170, 120); await sleep(100);
check('…but inside the box it still glides', await overlayIn(sb));
await sb.keyboard.press('Escape'); await sb.close();

// --- closed shadow roots ---
const sh = await open(`${B}/shadow.html`);
await midClick(sh, 150, 80); await sh.mouse.move(150, 200); await sleep(500);
const ls = await sh.evaluate(() => [listScroller.scrollTop, scrollY]);
check('slotted content in a closed shadow scroller', ls[0] > 100 && ls[1] === 0, `inner=${ls[0]} page=${ls[1]}`);
await sh.keyboard.press('Escape');
await midClick(sh, 500, 80); await sh.mouse.move(500, 200); await sleep(500);
const bs = await sh.evaluate(() => [boxScroller.scrollTop, scrollY]);
check('scroller inside a closed shadow root', bs[0] > 100 && bs[1] === 0, `inner=${bs[0]} page=${bs[1]}`);
await sh.keyboard.press('Escape');
await midClick(sh, 60, 238); await sleep(150);
check('link inside a closed shadow root still opens', !(await overlayIn(sh)) && (await sh.evaluate(() => events)).includes('auxclick:1'));
await sh.close();

// --- blocklist accepts pasted URLs ---
await setCfg({ blocklist: ['https://127.0.0.1:8123/test.html?x=1'] }); await sleep(150);
const bl = await open(`${B}/test.html`);
await midClick(bl, 170, 120); await sleep(100);
check('blocklist entry pasted as a full URL works', !(await overlayIn(bl)));
await setCfg({ blocklist: [] }); await bl.close();

// --- 3. settings page: rapid slider changes all saved, no quota errors ---
let writes = 0;
await worker.evaluate(() => { self.__w = 0; chrome.storage.onChanged.addListener(() => self.__w++); });
const op = await open(`chrome-extension://${extId}/options.html`, { wait: 500 });
for (const [id, n] of [['speed', 75], ['acceleration', 30], ['deadZone', 28], ['speed', 40], ['acceleration', 20]]) {
  await op.focus('#' + id);
  for (let i = 0; i < n; i++) await op.keyboard.press(i % 7 === 6 ? 'ArrowLeft' : 'ArrowRight');
}
// live preview: the test area already uses the new speed before saving
const ui = await op.evaluate(() => ({ speed: +speed.value, acceleration: +acceleration.value, deadZone: +deadZone.value }));
await sleep(1200);
const stored = await worker.evaluate(() => chrome.storage.sync.get(['speed', 'acceleration', 'deadZone']));
writes = await worker.evaluate(() => self.__w);
const statusText = await op.evaluate(() => document.getElementById('saved').textContent);
check('193 slider steps -> final values saved', ['speed','acceleration','deadZone'].every(k => ui[k] === stored[k]), `ui=${JSON.stringify(ui)} stored=${JSON.stringify(stored)}`);
check('…using only a handful of writes', writes <= 6, `writes=${writes}, status="${statusText}"`);
await op.screenshot({ path: shot('options2.png') });
await worker.evaluate(() => chrome.storage.sync.set({ speed: 1, acceleration: 1.6, deadZone: 12 }));

// popup
const pp = await browser.newPage();
await pp.setViewport({ width: 280, height: 260 });
await pp.goto(`chrome-extension://${extId}/popup.html`); await sleep(400);
await pp.screenshot({ path: shot('popup2.png') });
check('popup shows the private-window note', await pp.evaluate(() => !document.getElementById('private').hidden));

check('no JS errors on any page', errors.length === 0, errors.join(' | '));
await finish(browser);
