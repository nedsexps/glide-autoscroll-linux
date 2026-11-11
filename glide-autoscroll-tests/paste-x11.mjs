// Linux only: middle-click normally pastes the selected text. A glide must never do that,
// and ordinary middle-click paste into a text box must keep working.
// Needs a real display, so it opens a browser window (or run it under xvfb-run).
import { launch, extension, suite, sleep, B } from './lib.mjs';

const { check, finish } = suite('middle-click paste (X11)', 120000);
const browser = await launch({ headless: false, args: ['--ozone-platform=x11', '--window-size=1200,950'] });
await extension(browser);
const page = (await browser.pages())[0];
await page.goto(`${B}/probe.html`); await sleep(800);
const m = page.mouse;
const vals = () => page.evaluate(() => ({ ta: ta.value, ta2: ta2.value }));
const noPaste = v => v.ta === '' && v.ta2 === '';
const reset = () => page.evaluate(() => { ta.value = ''; ta2.value = ''; scrollTo(0, 0); window.events = []; });
const box = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y }; }, sel);
const overlay = () => page.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));

// Put text on the selection clipboard the normal way: drag-select it.
const t = await box('#text');
await m.move(t.x + 2, t.y + 8); await m.down(); await m.move(t.x + 300, t.y + 8, { steps: 8 }); await m.up(); await sleep(300);
const sel = await page.evaluate(() => getSelection().toString());
const b2 = await box('#ta2');
await m.click(b2.x + 20, b2.y + 20, { button: 'middle' }); await sleep(300);
check('control: middle-click into a text box pastes', sel.length > 0 && (await vals()).ta2 === sel, JSON.stringify(await vals()));
await reset();

const focusTa = async () => { const b = await box('#ta'); await m.click(b.x + 20, b.y + 20); await sleep(100); await page.evaluate(() => { window.events = []; }); };
const emb = await box('#embed');

await focusTa();
await m.click(t.x + 100, t.y + 8, { button: 'middle' }); await sleep(150);
await m.click(t.x + 100, t.y + 8); await sleep(300);
check('click-to-toggle glide: no paste', noPaste(await vals()), JSON.stringify(await vals()));
await reset();

await focusTa();
await m.move(t.x + 100, t.y + 8); await m.down({ button: 'middle' });
await m.move(b2.x + 20, b2.y + 20, { steps: 6 }); await sleep(200); await m.up({ button: 'middle' }); await sleep(300);
check('hold-drag released over a text box: no paste', noPaste(await vals()), JSON.stringify(await vals()));
await reset();

await focusTa();
await m.move(t.x + 100, t.y + 8); await m.down({ button: 'middle' }); await sleep(60);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(40); await m.up({ button: 'middle' }); await sleep(300);
check('hold middle + tap left: no paste', noPaste(await vals()), JSON.stringify(await vals()));
await reset();

await focusTa();
await m.move(t.x + 100, t.y + 8); await m.down({ button: 'middle' }); await sleep(60);
await m.down({ button: 'left' }); await m.up({ button: 'left' }); await sleep(40);
await m.move(b2.x + 20, b2.y + 20, { steps: 3 }); await m.up({ button: 'middle' }); await sleep(300);
check('hold middle + tap left, released over a text box: no paste', noPaste(await vals()), JSON.stringify(await vals()));
await reset();

await focusTa();
await m.move(emb.x + 150, emb.y + 60); await sleep(80);
await m.down({ button: 'middle' }); await m.up({ button: 'middle' }); await sleep(200);
const handedOn = await overlay();
await m.click(emb.x + 150, emb.y + 60); await sleep(300);
check('click in an embed (page takes over): glides, no paste', handedOn && noPaste(await vals()), JSON.stringify(await vals()));
await reset();

await focusTa();
await m.move(emb.x + 150, emb.y + 60); await sleep(80); await m.down({ button: 'middle' });
await m.move(b2.x + 20, b2.y + 20, { steps: 8 }); await sleep(200); await m.up({ button: 'middle' }); await sleep(300);
check('hold-drag from an embed, released over a text box: no paste', noPaste(await vals()) && !(await overlay()), JSON.stringify(await vals()));
await reset();

// nothing left behind afterwards
await m.click(b2.x + 20, b2.y + 20); await sleep(150);
const ev = await page.evaluate(() => window.events);
check('afterwards: an ordinary click reaches the page untouched', ['pointerdown:0', 'mousedown:0', 'pointerup:0', 'mouseup:0', 'click:0'].every(x => ev.includes(x)), JSON.stringify(ev));
await m.click(b2.x + 20, b2.y + 20, { button: 'middle' }); await sleep(300);
check('afterwards: middle-click paste into a text box still works', (await vals()).ta2 === sel, JSON.stringify(await vals()));

await finish(browser);
