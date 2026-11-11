// Regression tests for the fixes made in v1.2: bottom-up and right-to-left scroll areas,
// frames cooperating without screen coordinates, embeds that can't hand a click on,
// vanishing scroll targets, made-up events from pages, forged frame messages, settings page.
import { launch, extension, suite, sleep, overlayIn, midClick, maskedScreenCopy, B } from './lib.mjs';

const { check, finish } = suite('fixes 1.2', 300000);
const errors = [];

async function opener(browser) {
  return async (url, wait = 500) => {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(`${url}: ${e.message}`));
    await p.goto(url); await sleep(wait);
    return p;
  };
}
const frameOf = (p, part) => p.frames().find(f => f.url().includes(part));
const innerTop = f => f.evaluate(() => document.scrollingElement.scrollTop);

// Cross-frame behaviour, run twice: once normally and once with junk screen coordinates.
async function crossFrame(open, tag) {
  // click in an embed that has nothing to scroll: the page around it takes over
  let p = await open(`${B}/probe.html`, 700);
  await p.evaluate(() => { scrollTo(0, 0); window.events = []; });
  await midClick(p, 200, 380); await sleep(200);
  const started = await overlayIn(p);
  await p.mouse.move(201, 381); await sleep(400);
  check(`${tag}embed click: page takes over and holds still inside the dead zone`, started && await p.evaluate(() => scrollY) === 0, `scrollY=${await p.evaluate(() => scrollY)}`);
  await p.mouse.move(200, 380 + 42); await sleep(300);          // 30px past the dead zone
  const rate = await p.evaluate(() => new Promise(res => { const t0 = performance.now(), s0 = scrollY; setTimeout(() => res((scrollY - s0) / ((performance.now() - t0) / 1000)), 1000); }));
  const want = 1000 * Math.pow(0.3, 1.6);
  check(`${tag}embed click: speed matches the distance moved`, Math.abs(rate / want - 1) < 0.08, `${rate.toFixed(0)}px/s, expected ${want.toFixed(0)}`);
  await p.keyboard.press('Escape');
  // hold-drag from the embed: the embed keeps the mouse while the button is down
  await p.evaluate(() => scrollTo(0, 0)); await sleep(100);
  await p.mouse.move(200, 380); await sleep(80); await p.mouse.down({ button: 'middle' });
  await p.mouse.move(200, 386, { steps: 2 }); await sleep(300);
  const still = await p.evaluate(() => scrollY);
  await p.mouse.move(200, 470, { steps: 4 }); await sleep(400);
  const moved = await p.evaluate(() => scrollY);
  await p.mouse.up({ button: 'middle' }); await sleep(150);
  check(`${tag}embed hold-drag: still in the dead zone, scrolls past it, stops on release`, still === 0 && moved > 100 && !(await overlayIn(p)), `still=${still} moved=${moved}`);
  await p.close();

  // glide inside an iframe, pointer wanders out over the page
  p = await open(`${B}/test.html`, 700);
  let f = frameOf(p, 'inner.html');
  await midClick(p, 310, 400); await sleep(150);
  await p.mouse.move(325, 400, { steps: 3 }); await sleep(500);
  check(`${tag}iframe glide: pointer 15px outside the frame, level with the start, doesn't scroll`, await innerTop(f) === 0, `top=${await innerTop(f)}`);
  await p.mouse.move(325, 400 + 52, { steps: 3 }); await sleep(300);   // 40px past the dead zone, outside the frame
  const r2 = await f.evaluate(() => new Promise(res => { const se = document.scrollingElement, t0 = performance.now(), s0 = se.scrollTop; setTimeout(() => res((se.scrollTop - s0) / ((performance.now() - t0) / 1000)), 1000); }));
  const want2 = 1000 * Math.pow(0.4, 1.6);
  check(`${tag}iframe glide: speed from outside the frame matches the distance`, Math.abs(r2 / want2 - 1) < 0.08, `${r2.toFixed(0)}px/s, expected ${want2.toFixed(0)}`);
  await p.keyboard.press('Escape'); await p.close();

  // pointer moves from the gliding iframe into a different iframe
  p = await open(`${B}/two.html`, 800);
  f = frameOf(p, 'inner.html');
  await midClick(p, 170, 120); await sleep(150);
  await p.mouse.move(170, 380, { steps: 6 }); await sleep(250);     // now inside the other frame
  const a1 = await innerTop(f); await sleep(300); const a2 = await innerTop(f);
  check(`${tag}two iframes: still follows the pointer inside the other frame`, a2 > a1 + 200, `${a1} -> ${a2}`);
  await p.mouse.move(400, 124, { steps: 6 }); await sleep(500);     // out on the page, level with the start
  const b1 = await innerTop(f); await sleep(300); const b2 = await innerTop(f);
  check(`${tag}two iframes: back level with the start point, it stops`, b1 === b2, `${b1} -> ${b2}`);
  await p.keyboard.press('Escape'); await p.close();

  // driver two frames deep, pointer out on the top page
  p = await open(`${B}/nest2top.html`, 1000);
  f = frameOf(p, 'inner.html');
  // top-page position of the inner frame's content: 50+1+30+1 across, 60+1+40+1 down
  const ox = 82 + 100, oy = 102 + 50;
  await midClick(p, ox, oy); await sleep(150);
  const deep = await f.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
  await p.mouse.move(600, oy + 5, { steps: 5 }); await sleep(500);
  const n0 = await innerTop(f);
  await p.mouse.move(600, oy + 112, { steps: 5 }); await sleep(600);
  const n1 = await innerTop(f);
  check(`${tag}nested iframe: placed correctly from the top page, two frames up`, deep && n0 === 0 && n1 > 150, `started=${deep} level=${n0} below=${n1}`);
  await p.mouse.click(600, 600); await sleep(200);
  check(`${tag}nested iframe: a click on the top page stops it`, !(await f.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'))));
  await p.close();
}

// ---------------- normal build ----------------
const browser = await launch();
const { worker, id: extId } = await extension(browser);
const open = await opener(browser);

// bottom-up and right-to-left scroll areas count their position in negatives
let p = await open(`${B}/reverse.html`);
await midClick(p, 170, 120); await p.mouse.move(170, 40); await sleep(500);
const up = await p.evaluate(() => chat.scrollTop);
check('bottom-up list: glides up from the bottom', up < -100, `scrollTop=${up}`);
await p.keyboard.press('Escape');
await p.evaluate(() => { chat.scrollTop = -1500; }); await sleep(100);
await midClick(p, 170, 120); await p.mouse.move(170, 150); await sleep(500);
const down = await p.evaluate(() => chat.scrollTop);
check('bottom-up list: starting partway up doesn\'t snap to the bottom', down > -1500 && down < -1400, `scrollTop=${down}`);
await p.keyboard.press('Escape');
await midClick(p, 500, 70); await p.mouse.move(400, 70); await sleep(500);
const left = await p.evaluate(() => rtl.scrollLeft);
check('right-to-left carousel: glides left', left < -50, `scrollLeft=${left}`);
await p.keyboard.press('Escape'); await p.close();

// pushing against the end of a box must not build up a backlog
p = await open(`${B}/endbox.html`);
await p.evaluate(() => { v.scrollTop = 1e6; });
const max = await p.evaluate(() => v.scrollTop);
await midClick(p, 170, 120); await p.mouse.move(170, 120 + 30); await sleep(2500);   // ~60px/s into the bottom
await p.mouse.move(170, 120 - 30); await sleep(350);
const back = await p.evaluate(() => v.scrollTop);
check('held against the end, then reversed: responds straight away', back < max - 5, `max=${max} now=${back}`);
await p.keyboard.press('Escape'); await p.close();

// returning to the start point stops promptly instead of coasting on
p = await open(`${B}/test.html`);
await midClick(p, 170, 120); await p.mouse.move(170, 220); await sleep(600);   // ~800px/s
await p.mouse.move(170, 120);
const coast = await p.evaluate(() => new Promise(res => {
  const el = document.getElementById('v'); const t0 = performance.now(); let last = el.scrollTop, lastMove = t0; const start = last;
  const f = () => { const now = performance.now(); if (el.scrollTop !== last) { last = el.scrollTop; lastMove = now; }
    if (now - t0 < 1000) requestAnimationFrame(f); else res({ ms: Math.round(lastMove - t0), px: Math.round(last - start) }); };
  requestAnimationFrame(f);
}));
check('back at the start point: stops within a few frames', coast.ms < 200 && coast.px < 30, `coasted ${coast.px}px over ${coast.ms}ms`);
await p.keyboard.press('Escape'); await p.close();

// an embed whose page can't scroll either keeps its own middle-click
p = await open(`${B}/declined-top.html`, 800);
let f = frameOf(p, 'handler.html');
await midClick(p, 200, 90); await sleep(200);
const saw = await f.evaluate(() => events);
check('embed with nothing to scroll anywhere: its own handlers get the click', ['mousedown:1', 'mouseup:1', 'auxclick:1'].every(x => saw.includes(x)), JSON.stringify(saw));
await p.close();

// the page scrolls an embed under a mouse that never moves, then a middle-click
p = await open(`${B}/probe.html`, 700);
await p.mouse.move(200, 150); await sleep(100);                 // parked on the page, above the embed
await p.evaluate(() => scrollTo(0, 200)); await sleep(400);     // the embed is now under the pointer
await p.mouse.down({ button: 'middle' }); await p.mouse.up({ button: 'middle' }); await sleep(250);
check('embed arrives under a still mouse: first middle-click already works', await overlayIn(p));
await p.keyboard.press('Escape'); await p.close();

// the page only becomes scrollable later; the embed must hear about it without mouse movement
p = await open(`${B}/latepage.html`, 800);
await p.mouse.move(200, 120); await sleep(300);                 // inside the embed; nothing can scroll yet
await p.evaluate(() => { grow(); scrollTo(0, 20); }); await sleep(500);
await p.mouse.down({ button: 'middle' }); await p.mouse.up({ button: 'middle' }); await sleep(250);
check('page becomes scrollable later: embed is told, first middle-click works', await overlayIn(p));
await p.keyboard.press('Escape'); await p.close();

// a page can't fake the message one frame sends another
p = await open(`${B}/forge-top.html`, 1200);
await p.mouse.click(700, 300); await sleep(700);
const forged = await overlayIn(p);
await p.mouse.click(520, 510); await sleep(100);
check('forged frame message after a real click: ignored, next click works', !forged && await p.evaluate(() => window.clicked === 1));
await p.close();

// what's being scrolled disappears mid-glide
p = await open(`${B}/test.html`);
await midClick(p, 170, 120); await p.mouse.move(170, 200); await sleep(200);
await p.evaluate(() => document.getElementById('v').remove()); await sleep(400);
check('scroll box removed mid-glide: the glide ends by itself', !(await overlayIn(p)));
await p.evaluate(() => { window.events = []; });
await p.mouse.click(700, 650); await sleep(100);
check('…and the next click isn\'t eaten', (await p.evaluate(() => events)).includes('click:0'));
await p.close();

// a modal opening mid-glide would leave the overlay unable to receive the mouse
p = await open(`${B}/probe.html`, 600);
await midClick(p, 600, 150); await sleep(100);
await p.evaluate(() => document.getElementById('dlg').showModal()); await sleep(500);
const dr = await p.evaluate(() => { const r = document.getElementById('dlg').getBoundingClientRect(); return { x: r.x + 50, y: r.y + 40 }; });
await p.mouse.move(dr.x, dr.y); await p.mouse.move(dr.x + 3, dr.y + 3); await sleep(100);
check('modal opens mid-glide: overlay moves into it and still gets the mouse',
  await p.evaluate(() => !!document.querySelector('dialog glide-autoscroll-overlay')) && await p.evaluate(() => lastMoveTarget) === 'glide-autoscroll-overlay',
  `target=${await p.evaluate(() => lastMoveTarget)}`);
await p.evaluate(() => document.getElementById('dlg').close()); await sleep(500);
check('modal closes mid-glide: overlay comes back out', await p.evaluate(() => { const o = document.querySelector('glide-autoscroll-overlay'); return !!o && o.parentNode === document.documentElement; }));
await p.keyboard.press('Escape'); await p.close();

// events made up by page scripts don't steer it; real ones still do
p = await open(`${B}/test.html`);
await midClick(p, 800, 600); await sleep(100);
await p.evaluate(() => {
  document.body.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true }));
}); await sleep(100);
const survived = await overlayIn(p);
await p.keyboard.press('a'); await sleep(100);
check('made-up mouse, key and wheel events: ignored; a real key still stops it', survived && !(await overlayIn(p)));
await p.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, clientX: 800, clientY: 600 }))); await sleep(100);
check('made-up middle click: doesn\'t start a glide', !(await overlayIn(p)));
await p.close();

await crossFrame(open, '');

// settings page
p = await open(`chrome-extension://${extId}/options.html`, 500);
check('settings page leaves the browser\'s built-in globals alone', await p.evaluate(() => typeof window.status === 'string'));
await worker.evaluate(() => chrome.storage.sync.set({ blocklist: ['example.com'], speed: 2.5, mode: 'hold' })); await sleep(300);
await p.focus('input[name=mode]:checked');
await p.keyboard.press('ArrowLeft'); await sleep(300);
const kb = await worker.evaluate(() => chrome.storage.sync.get(['mode']));
check('click style can be changed from the keyboard', kb.mode === 'sticky', JSON.stringify(kb));
await p.click('#reset'); await sleep(400);
const after = await worker.evaluate(() => chrome.storage.sync.get(['blocklist', 'speed', 'mode']));
check('reset restores behaviour but keeps the disabled-sites list', after.speed === 1 && after.mode === 'both' && after.blocklist.length === 1 && after.blocklist[0] === 'example.com', JSON.stringify(after));
check('…and the page shows that', await p.evaluate(() => document.getElementById('blocklist').value === 'example.com' && document.getElementById('speed').value === '1'));
const unlabeled = await p.evaluate(() => [...document.querySelectorAll('input, textarea')].filter(el => el.type !== 'radio' && !el.closest('.test') && !el.getAttribute('aria-labelledby')).length);
check('every control has a label for screen readers', unlabeled === 0, `unlabeled=${unlabeled}`);
await worker.evaluate(() => chrome.storage.sync.set({ blocklist: [] }));
await p.close();

// ---------------- same cross-frame tests with junk screen coordinates ----------------
const masked = await launch({ ext: maskedScreenCopy() });
await extension(masked);
await crossFrame(await opener(masked), 'junk screen coords — ');

check('no JS errors on any page', errors.length === 0, errors.join(' | '));
await finish(browser, masked);
