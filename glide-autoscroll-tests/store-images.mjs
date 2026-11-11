// Makes the Chrome Web Store images from the real extension running on the demo pages in
// ../glide-autoscroll-store/art. Run again after UI changes so screenshots stay current.
//   node store-images.mjs   ->   ../glide-autoscroll-store/images/*.png
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launch, extension, sleep, midClick, EXT, HERE } from './lib.mjs';
import { decode, encodeRGB, half } from './png.mjs';

const ROOT = path.resolve(HERE, '..');                         // serves the art and the extension's icons
const STORE = path.join(ROOT, 'glide-autoscroll-store');
const OUT = path.join(STORE, 'images');
const PORT = 8125;
const SITE = `http://themeander.example:${PORT}`;              // .example is reserved: clearly not a real site
const ART = `${SITE}/glide-autoscroll-store/art`;
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await launch({ args: [`--host-resolver-rules=MAP themeander.example 127.0.0.1`] });
const { worker, id } = await extension(browser);
await worker.evaluate(() => chrome.storage.sync.clear());
const made = [];

function save(name, buf, { w, h, halve = false }) {
  let img = decode(buf);
  if (halve) img = half(img);
  if (img.w !== w || img.h !== h) throw new Error(`${name}: got ${img.w}x${img.h}, expected ${w}x${h}`);
  fs.writeFileSync(path.join(OUT, name), encodeRGB(img.w, img.h, img.rgba));
  made.push(`${name} ${w}x${h}`);
}

// 1280x800 from a smaller CSS viewport, so text survives the store's half-size display
async function page(url, cssW, cssH) {
  const p = await browser.newPage();
  await p.setViewport({ width: cssW, height: cssH, deviceScaleFactor: 1280 / cssW });
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await sleep(300);
  return p;
}

// What the screenshot can't capture by itself: the pointer, and a one-line caption.
async function dress(p, { cursor, caption, corner = 'bl' }) {
  await p.evaluate(({ cursor, caption, corner }) => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    if (cursor) layer.insertAdjacentHTML('beforeend',
      `<svg viewBox="0 0 24 32" style="position:absolute;left:${cursor.x - 12}px;top:${cursor.y - 16}px;width:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">
         <path d="M9 1h6v17h6.5L12 30.5 2.5 18H9z" fill="#141418" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`);
    if (caption) {
      const chip = document.createElement('div');
      const pos = { bl: 'left:18px;bottom:18px', br: 'right:18px;bottom:18px' }[corner];
      chip.style.cssText = `position:absolute;${pos};padding:10px 16px 11px;border-radius:10px;background:rgba(20,22,30,.9);color:#fff;
        font:600 17px/1.2 Inter,sans-serif;letter-spacing:-.005em;box-shadow:0 6px 18px rgba(0,0,0,.18)`;
      chip.textContent = caption;
      layer.appendChild(chip);
    }
    document.documentElement.appendChild(layer);
  }, { cursor, caption, corner });
  await sleep(150);
}

// Start a real glide at (x, y) and hold the pointer inside the dead zone, so the indicator
// is showing but the page is still for the screenshot.
async function glideAt(p, x, y) {
  await midClick(p, x, y);
  await p.mouse.move(x + 2, y + 3);
  await sleep(450);
  if (!(await p.evaluate(() => !!document.querySelector('glide-autoscroll-overlay')))) throw new Error('glide did not start');
}

// ---- 1: an article, mid-glide ----
{
  const p = await page(`${ART}/article.html`, 800, 500);
  await p.evaluate(() => {
    const fig = document.querySelector('figure');
    scrollTo(0, fig.getBoundingClientRect().top + scrollY + 170);   // bottom of the picture, then the text
  });
  await sleep(200);
  await glideAt(p, 400, 300);
  await dress(p, { cursor: { x: 400, y: 384 }, caption: 'Middle-click, then move the mouse: the page glides' });
  save('screenshot-1-glide.png', await p.screenshot(), { w: 1280, h: 800 });
  await p.close();
}

// ---- 2: an app-style page, the middle panel scrolling ----
{
  const p = await page(`${ART}/notes.html`, 800, 500);
  await p.evaluate(() => { document.getElementById('items').scrollTop = 130; });
  await glideAt(p, 326, 250);
  await dress(p, { cursor: { x: 326, y: 330 }, caption: 'Scrolls the panel under the pointer', corner: 'br' });
  save('screenshot-2-panels.png', await p.screenshot(), { w: 1280, h: 800 });
  await p.close();
}

// ---- 3: settings, with the test area mid-glide ----
{
  const p = await page(`chrome-extension://${id}/options.html`, 960, 600);
  const box = await p.evaluate(() => { const r = document.getElementById('vbox').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 80 }; });
  await p.evaluate(() => { document.getElementById('vbox').scrollTop = 220; });
  await glideAt(p, Math.round(box.x), Math.round(box.y));
  await dress(p, { cursor: { x: Math.round(box.x), y: Math.round(box.y) + 78 }, caption: 'Tune the feel, and try it right there', corner: 'br' });
  save('screenshot-3-settings.png', await p.screenshot(), { w: 1280, h: 800 });
  await p.close();
}

// ---- 4: the toolbar popup over a site ----
{
  // the popup as it shows on that site, rendered sharp
  const pp = await browser.newPage();
  await pp.evaluateOnNewDocument(site => {
    chrome.tabs.query = async () => [{ id: 1, url: site }];
    chrome.extension.isAllowedIncognitoAccess = cb => cb(true);
    chrome.extension.isAllowedFileSchemeAccess = cb => cb(true);
  }, 'https://themeander.example/rivers/why-rivers-never-run-straight');
  await pp.setViewport({ width: 280, height: 200, deviceScaleFactor: 3 });
  await pp.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
  await pp.evaluate(() => document.fonts.ready);
  await sleep(400);
  const popH = await pp.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
  const pop = await pp.screenshot({ clip: { x: 0, y: 0, width: 280, height: popH } });
  await pp.close();

  const p = await page(`${ART}/article.html`, 800, 500);
  await p.evaluate((src, popH) => {
    const shade = document.createElement('div');
    shade.style.cssText = 'position:fixed;inset:0;background:rgba(20,22,30,.16);z-index:2147483645';
    const img = document.createElement('img');
    img.src = src;
    const w = 300;
    img.style.cssText = `position:fixed;right:22px;top:14px;width:${w}px;height:${Math.round(popH * w / 280)}px;border-radius:10px;
      box-shadow:0 18px 40px -8px rgba(10,15,40,.35),0 0 0 1px rgba(10,15,40,.08);z-index:2147483646`;
    document.documentElement.append(shade, img);
    return new Promise(r => img.complete ? r() : (img.onload = r));
  }, `data:image/png;base64,${pop.toString('base64')}`, popH);
  await dress(p, { caption: 'Switch it off for any site in one click' });
  save('screenshot-4-popup.png', await p.screenshot(), { w: 1280, h: 800 });
  await p.close();
}

// ---- promo tiles (drawn at 2x, averaged down) ----
for (const [size, w, h, name] of [['small', 440, 280, 'small-promo-tile-440x280.png'], ['marquee', 1400, 560, 'marquee-promo-tile-1400x560.png']]) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await p.goto(`${ART}/promo.html?size=${size}`, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await sleep(300);
  save(name, await p.screenshot(), { w, h, halve: true });
  await p.close();
}

// ---- store icon: the extension's own 128 icon (96px artwork, 16px transparent padding) ----
fs.copyFileSync(path.join(EXT, 'icons', 'icon128.png'), path.join(OUT, 'store-icon-128x128.png'));
made.push('store-icon-128x128.png 128x128');

console.log(made.map(m => `  ${m}`).join('\n'));
await browser.close();
server.close();
process.exit(0);
