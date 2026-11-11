// Chrome Web Store readiness: manifest limits, permissions, icons, no remote code,
// and the real toolbar popup on a normal site and on a browser page.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, extension, suite, sleep, EXT, B } from './lib.mjs';

const { check, finish } = suite('store readiness', 120000);

// ---------- static checks ----------
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
check('name fits (75 max)', manifest.name.length <= 75, `${manifest.name.length}`);
check('short name fits (12 max)', !manifest.short_name || manifest.short_name.length <= 12);
check('summary/description fits (132 max)', manifest.description.length <= 132, `${manifest.description.length}`);
check('version is 1-4 dot-separated integers', /^\d+(\.\d+){0,3}$/.test(manifest.version), manifest.version);
check('only the permissions it uses: storage, scripting', JSON.stringify([...manifest.permissions].sort()) === '["scripting","storage"]', JSON.stringify(manifest.permissions));
check('host access is declared once, as <all_urls>', JSON.stringify(manifest.host_permissions) === '["<all_urls>"]');

// PNG size from the IHDR chunk; alpha at a pixel by decoding (8-bit RGBA, non-interlaced only)
function pngInfo(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25], buf };
}
function rgbaAt(file, x, y) {
  const { w, buf } = pngInfo(file);
  const chunks = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = w * 4, rows = [];
  let prev = Buffer.alloc(stride);
  for (let r = 0, o = 0; o < raw.length; r++) {
    const f = raw[o++], line = Buffer.from(raw.subarray(o, o + stride)); o += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[i] = (line[i] + pred) & 255;
    }
    rows.push(line); prev = line;
  }
  return [...rows[y].subarray(x * 4, x * 4 + 4)];
}
for (const [size, file] of Object.entries(manifest.icons)) {
  const info = pngInfo(path.join(EXT, file));
  check(`icon ${size} is a ${size}x${size} PNG`, info.w === +size && info.h === +size, `${info.w}x${info.h}`);
}
const icon128 = path.join(EXT, manifest.icons['128']);
const isRGBA = pngInfo(icon128).colorType === 6;
check('128 icon: artwork 96x96 with 16px transparent padding', isRGBA &&
  rgbaAt(icon128, 8, 64)[3] === 0 && rgbaAt(icon128, 64, 8)[3] === 0 && rgbaAt(icon128, 20, 64)[3] === 255 && rgbaAt(icon128, 64, 107)[3] === 255);

// everything the manifest and pages point at is in the package
const referenced = new Set(['background.js', manifest.action.default_popup, manifest.options_ui.page,
  ...manifest.content_scripts.flatMap(c => c.js), ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]);
for (const html of [manifest.action.default_popup, manifest.options_ui.page]) {
  for (const m of fs.readFileSync(path.join(EXT, html), 'utf8').matchAll(/(?:src|href)="([^"#:]+)"/g)) referenced.add(m[1]);
}
const missing = [...referenced].filter(f => !fs.existsSync(path.join(EXT, f)));
check('every file the manifest and pages reference exists', missing.length === 0, missing.join(', '));

// no remote code, no network use, nothing obfuscated
const scripts = fs.readdirSync(EXT).filter(f => f.endsWith('.js'));
const banned = /\beval\s*\(|new\s+Function\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|importScripts|\bimport\s*\(|sendBeacon|https?:\/\/(?!www\.w3\.org\/)/;
const withoutComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const offenders = scripts.filter(f => banned.test(withoutComments(fs.readFileSync(path.join(EXT, f), 'utf8'))));
check('no remote code or network calls in any script', offenders.length === 0, offenders.join(', '));
const htmlRemote = ['popup.html', 'options.html'].filter(f => /<script[^>]+src="https?:|<link[^>]+href="https?:/.test(fs.readFileSync(path.join(EXT, f), 'utf8')));
check('pages load nothing from the web', htmlRemote.length === 0, htmlRemote.join(', '));

// ---------- listing images, if they've been made (node store-images.mjs) ----------
const IMAGES = path.join(path.dirname(EXT), 'glide-autoscroll-store', 'images');
if (fs.existsSync(IMAGES)) {
  const want = {
    'store-icon-128x128.png': [128, 128, 6],
    'screenshot-1-glide.png': [1280, 800, 2], 'screenshot-2-panels.png': [1280, 800, 2],
    'screenshot-3-settings.png': [1280, 800, 2], 'screenshot-4-popup.png': [1280, 800, 2],
    'small-promo-tile-440x280.png': [440, 280, 2], 'marquee-promo-tile-1400x560.png': [1400, 560, 2],
  };
  for (const [name, [w, h, type]] of Object.entries(want)) {
    const file = path.join(IMAGES, name);
    const info = fs.existsSync(file) ? pngInfo(file) : null;
    check(`image ${name}: ${w}x${h}${type === 2 ? ', no alpha' : ''}`, info && info.w === w && info.h === h && info.colorType === type,
      info ? `${info.w}x${info.h} type ${info.colorType}` : 'missing');
  }
  const icon = fs.existsSync(path.join(IMAGES, 'store-icon-128x128.png')) && fs.readFileSync(path.join(IMAGES, 'store-icon-128x128.png'));
  check('store icon is the same file as the extension\'s 128 icon', icon && icon.equals(fs.readFileSync(icon128)));
}

// ---------- the real toolbar popup ----------
const browser = await launch();
const { worker } = await extension(browser);
const openPopup = async page => {
  await page.bringToFront(); await sleep(200);
  await worker.evaluate('chrome.action.openPopup()');
  const t = await browser.waitForTarget(x => x.url().endsWith('/popup.html'), { timeout: 5000 });
  const p = await t.asPage(); await sleep(500);
  return p;
};
const state = p => p.evaluate(() => ({
  host: document.getElementById('host').textContent,
  siteDisabled: document.getElementById('site').disabled,
  siteOn: document.getElementById('site').checked,
  note: document.getElementById('note').hidden ? '' : document.getElementById('note').textContent,
}));

const page = await browser.newPage();
await page.goto(`${B}/test.html`); await sleep(400);
let pop = await openPopup(page);
let s = await state(pop);
check('popup on a normal site: knows the site, switch on', s.host === '127.0.0.1' && !s.siteDisabled && s.siteOn, JSON.stringify(s));
await pop.click('#site'); await sleep(300);
const bl = (await worker.evaluate(() => chrome.storage.sync.get('blocklist'))).blocklist;
check('popup: switching the site off adds it to the disabled list', JSON.stringify(bl) === '["127.0.0.1"]', JSON.stringify(bl));
await pop.close().catch(() => {});
await page.bringToFront();
await page.mouse.move(170, 120); await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' }); await sleep(150);
check('…and the site really is off', !(await page.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'))));
await worker.evaluate(() => chrome.storage.sync.set({ blocklist: [] }));

const cp = await browser.newPage();
await cp.goto('chrome://version'); await sleep(300);
pop = await openPopup(cp);
s = await state(pop);
check('popup on a browser page: explains it can\'t run there', s.siteDisabled && /can't run here/.test(s.note), JSON.stringify(s));

await finish(browser);
