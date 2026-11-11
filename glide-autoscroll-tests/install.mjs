// Tabs that are already open when the extension is installed, updated, or switched off and on.
import { launch, suite, sleep, EXT, B } from './lib.mjs';

const { check, finish } = suite('install, update, off/on', 120000);
const browser = await launch({ install: true });
const ext = EXT;

const overlay = p => p.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));
const tryGlide = async p => {
  await p.bringToFront();
  await p.evaluate(() => { window.events = []; document.getElementById('v').scrollTop = 0; });
  await p.mouse.move(170, 120); await p.mouse.down({ button: 'middle' }); await p.mouse.up({ button: 'middle' });
  await p.mouse.move(170, 200); await sleep(300);
  const on = await overlay(p);
  const moved = await p.evaluate(() => document.getElementById('v').scrollTop);
  await p.mouse.down({ button: 'left' }); await p.mouse.up({ button: 'left' }); await sleep(100);
  const off = !(await overlay(p));
  const events = await p.evaluate(() => window.events);
  return { on, moved, off, events };
};

const tab = await browser.newPage();
await tab.goto(`${B}/test.html`); await sleep(300);
const id = await browser.installExtension(ext);
await sleep(1500);
let r = await tryGlide(tab);
check('tab open before install: works without a refresh', r.on && r.moved > 50 && r.off, JSON.stringify(r));

// an update while the tab stays open
await browser.installExtension(ext);
await sleep(1800);
const opt = await browser.newPage();
await opt.goto(`chrome-extension://${id}/options.html`); await sleep(500);
await opt.evaluate(() => chrome.storage.sync.set({ enabled: false })); await sleep(300);
r = await tryGlide(tab);
check('after update: open tab obeys the off switch (old copy retired)', !r.on, JSON.stringify(r));
await opt.evaluate(() => chrome.storage.sync.set({ enabled: true })); await sleep(300);
r = await tryGlide(tab);
check('after update: open tab glides with one copy (one click stops, page sees nothing)', r.on && r.moved > 50 && r.off && r.events.length === 0, JSON.stringify(r));
await opt.close();

// switched off and on again from the browser's extensions page
const mgr = await browser.newPage();
await mgr.goto('chrome://extensions'); await sleep(800);
const canToggle = await mgr.evaluate(() => typeof chrome.management?.setEnabled === 'function');
if (canToggle) {
  await mgr.evaluate(i => new Promise(res => chrome.management.setEnabled(i, false, res)), id); await sleep(800);
  r = await tryGlide(tab);
  check('extension switched off: open tab stops responding, clicks pass through', !r.on && r.events.includes('auxclick:1'), JSON.stringify(r));
  await mgr.bringToFront();
  await mgr.evaluate(i => new Promise(res => chrome.management.setEnabled(i, true, res)), id); await sleep(1500);
  r = await tryGlide(tab);
  check('switched back on: open tab works again without a refresh', r.on && r.moved > 50 && r.off, JSON.stringify(r));
} else {
  console.log('SKIP  off/on test: this browser doesn\'t expose its extensions page to automation');
}

await finish(browser);
