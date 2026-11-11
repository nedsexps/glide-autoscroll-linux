// Core behaviour: what gets scrolled, click styles, exclusions, iframes, settings pages.
import { launch, suite, sleep, shot } from './lib.mjs';

const { check, finish } = suite('core');
const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8123/test.html', { waitUntil: 'load' });
await sleep(800);
const m = page.mouse;
const st = sel => page.evaluate(s => {
  const el = s === 'root' ? document.scrollingElement : s === 'shadow' ? document.getElementById('host').shadowRoot.getElementById('s') : document.querySelector(s);
  return { top: el.scrollTop, left: el.scrollLeft };
}, sel);
const overlay = () => page.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
const reset = () => page.evaluate(() => { document.querySelectorAll('#v,#h,#snap').forEach(e => { e.scrollTop = 0; e.scrollLeft = 0; }); document.getElementById('host').shadowRoot.getElementById('s').scrollTop = 0; window.scrollTo({ top: 0, behavior: 'instant' }); window.events = []; });

// 1. sticky mode in inner vertical scroller
await reset();
await m.move(170, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
check('overlay appears on middle-click', await overlay());
await m.move(170, 220);
await sleep(600);
let v = await st('#v'); const root1 = await st('root');
check('sticky: inner scroller scrolls down', v.top > 100, `v.top=${v.top}`);
check('sticky: page itself untouched', root1.top === 0, `root=${root1.top}`);
await m.move(170, 120); // back to deadzone
await sleep(300);
const a = (await st('#v')).top; await sleep(300); const b = (await st('#v')).top;
check('dead zone: stops moving at origin', a === b, `${a} -> ${b}`);
await m.move(170, 40); await sleep(400);
check('scrolls back up', (await st('#v')).top < b, `top=${(await st('#v')).top}`);
await m.down({ button: 'left' }); await m.up({ button: 'left' });
check('any click stops + removes overlay', !(await overlay()));
let ev = await page.evaluate(() => window.events);
check('page never saw the clicks', ev.length === 0, JSON.stringify(ev));

// 2. hold-and-drag on page background
await reset();
await m.move(800, 600); await m.down({ button: 'middle' });
await m.move(800, 750, { steps: 5 }); await sleep(500);
const rootHeld = (await st('root')).top;
check('hold-drag: page scrolls (smooth html ignored)', rootHeld > 100, `root=${rootHeld}`);
await m.up({ button: 'middle' });
check('hold-drag: release stops', !(await overlay()));
const r1 = (await st('root')).top; await sleep(300); const r2 = (await st('root')).top;
check('no drift after release', r1 === r2, `${r1} -> ${r2}`);

// 3. horizontal carousel
await reset();
await m.move(500, 70); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await m.move(650, 70); await sleep(500);
check('horizontal scroller scrolls sideways', (await st('#h')).left > 50, `left=${(await st('#h')).left}`);
await page.keyboard.press('Escape');
check('Escape stops', !(await overlay()));

// 4. scroll-snap container glides smoothly instead of jumping
await reset();
await m.move(800, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await m.move(800, 160); await sleep(400);
const sn = (await st('#snap')).top;
check('snap container: slow glide not stuck to snap points', sn > 0 && sn % 200 !== 0, `top=${sn}`);
const snapStyleDuring = await page.evaluate(() => document.getElementById('snap').style.scrollSnapType);
await page.keyboard.press('Escape');
const snapStyleAfter = await page.evaluate(() => document.getElementById('snap').style.scrollSnapType);
check('snap suspended during, restored after', snapStyleDuring === 'none' && snapStyleAfter === '', `${snapStyleDuring} / '${snapStyleAfter}'`);

// 5. links excluded
await reset();
await m.move(40, 266); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
check('middle-click on link: no autoscroll', !(await overlay()));
ev = await page.evaluate(() => window.events);
check('link: browser/page gets the click normally', ev.includes('auxclick:1'), JSON.stringify(ev));

// 6. textarea excluded
await reset();
await m.move(200, 290); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
check('textarea: no autoscroll (paste preserved)', !(await overlay()));

// 7. shadow DOM scroller
await reset();
await m.move(500, 210); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await m.move(500, 300); await sleep(500);
check('shadow DOM scroller scrolls', (await st('shadow')).top > 50, `top=${(await st('shadow')).top}`);
await page.mouse.wheel({ deltaY: 1 }); await sleep(50);
check('wheel stops', !(await overlay()));

// 8. Ctrl+middle bypass
await reset();
await page.keyboard.down('Control');
await m.move(170, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await page.keyboard.up('Control');
check('Ctrl+middle bypasses', !(await overlay()));

// 9. cross-origin iframe, mouse leaves the frame, then stop via click on parent
await reset();
const frame = page.frames().find(f => f.url().includes('inner.html'));
await m.move(170, 400); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await sleep(100);
const fOverlay = await frame.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
check('iframe: glide starts inside cross-origin frame', fOverlay);
await m.move(170, 700, { steps: 4 }); // leave the iframe downwards
await sleep(700);
const ft = await frame.evaluate(() => document.scrollingElement.scrollTop);
check('iframe: keeps scrolling after mouse leaves frame (relay)', ft > 100, `inner top=${ft}`);
check('iframe: parent page not scrolled', (await st('root')).top === 0);
await m.down({ button: 'left' }); await m.up({ button: 'left' });
await sleep(200);
const fOverlay2 = await frame.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
check('iframe: click on parent stops it', !fOverlay2);
ev = await page.evaluate(() => window.events);
check('iframe: parent click swallowed', !ev.includes('click:0'), JSON.stringify(ev));

// 10. settings: blocklist + disable
const [sw] = await Promise.all([browser.waitForTarget(t => t.type() === 'service_worker')]);
const worker = await sw.worker();
await worker.evaluate(() => chrome.storage.sync.set({ blocklist: ['127.0.0.1'] }));
await sleep(200); await reset();
await m.move(170, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
check('blocklisted site: inactive', !(await overlay()));
await worker.evaluate(() => chrome.storage.sync.set({ blocklist: [], mode: 'hold' }));
await sleep(200); await reset();
await m.move(170, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
check('hold-only mode: quick click does not stick', !(await overlay()));
await worker.evaluate(() => chrome.storage.sync.set({ mode: 'both' }));

// 11. smoothness: per-frame step consistency at constant offset
await reset();
await m.move(170, 120); await m.down({ button: 'middle' }); await m.up({ button: 'middle' });
await m.move(170, 160); await sleep(400);
const samples = await page.evaluate(() => new Promise(res => {
  const el = document.getElementById('v'); const out = []; let last = el.scrollTop, n = 0;
  function f() { const t = el.scrollTop; out.push(t - last); last = t; if (++n < 40) requestAnimationFrame(f); else res(out); }
  requestAnimationFrame(f);
}));
const zeros = samples.filter(x => x === 0).length;
const bigs = samples.filter(x => x > 6).length;
check('smoothness: steady small steps, no stalls/jumps', zeros <= 4 && bigs === 0, `steps=${samples.join(',')}`);
await page.keyboard.press('Escape');

// 12. options page renders + works
const extId = new URL(sw.url()).host;
const op = await browser.newPage();
op.on('pageerror', e => errors.push('options: ' + e.message));
await op.goto(`chrome-extension://${extId}/options.html`);
await sleep(500);
await op.screenshot({ path: shot('options.png') });
await op.mouse.move(800, 260); await op.mouse.down({ button: 'middle' }); await op.mouse.up({ button: 'middle' });
await op.mouse.move(800, 360); await sleep(500);
const ovTop = await op.evaluate(() => document.getElementById('vbox').scrollTop);
await op.screenshot({ path: shot('options-glide.png') });
check('options test area works', ovTop > 50, `top=${ovTop}`);
await op.keyboard.press('Escape');

const pp = await browser.newPage();
await pp.setViewport({ width: 280, height: 220 });
await pp.goto(`chrome-extension://${extId}/popup.html`);
await sleep(300);
await pp.screenshot({ path: shot('popup.png') });

check('no JS errors', errors.length === 0, errors.join(' | '));
await finish(browser);
