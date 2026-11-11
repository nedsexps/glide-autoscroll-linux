// Shared plumbing for the Glide Autoscroll browser tests.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
// The extension under test: the folder next to this one, unless GLIDE_EXT says otherwise.
export const EXT = path.resolve(process.env.GLIDE_EXT || path.join(HERE, '..', 'glide-autoscroll'));
// Test pages are served from two origins so embedded frames are genuinely cross-site.
export const B = 'http://127.0.0.1:8123';
const PORTS = [8123, 8124];
const OUT = path.join(HERE, 'out');

export const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.GLIDE_BROWSER,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/brave', '/usr/bin/brave-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('No browser found. Set GLIDE_BROWSER=/path/to/chrome-or-brave');
  return found;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const servers = [];

function serveSite() {
  const root = path.join(HERE, 'site');
  return Promise.all(PORTS.map(port => new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = path.join(root, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, ''));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', e => reject(new Error(`Can't serve test pages on port ${port}: ${e.message}`)));
    server.listen(port, '127.0.0.1', () => { servers.push(server); resolve(); });
  })));
}

// opts: ext (folder to load), install (start with no extension; the test installs it itself),
// headless (default true), scrollbars (show real scrollbars), args (extra browser flags)
export async function launch(opts = {}) {
  if (!servers.length) await serveSite();
  const headless = opts.headless !== false;
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless,
    pipe: true,
    enableExtensions: opts.install ? true : [opts.ext || EXT],
    ignoreDefaultArgs: opts.scrollbars ? ['--hide-scrollbars'] : [],
    args: ['--no-proxy-server', ...(isRoot ? ['--no-sandbox'] : []), ...(opts.args || [])],
    defaultViewport: headless ? { width: 1200, height: 900 } : null,
  });
}

// The extension's background worker (for changing settings) and its id.
export async function extension(browser) {
  const target = await browser.waitForTarget(t => t.type() === 'service_worker');
  return { worker: await target.worker(), id: new URL(target.url()).host };
}

export const overlayIn = p => p.evaluate(() => !!document.querySelector('glide-autoscroll-overlay'));

// A middle click the way a person does it: arrive, then press.
export async function midClick(p, x, y) {
  await p.mouse.move(x, y);
  await sleep(80);
  await p.mouse.down({ button: 'middle' });
  await p.mouse.up({ button: 'middle' });
}

export function shot(name) {
  fs.mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

// A temporary copy of the extension whose content script gets meaningless screen
// coordinates, different in every frame — harsher than what Brave's fingerprinting
// protection does. Anything that still depended on screenX/screenY would fall over.
export function maskedScreenCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glide-masked-'));
  fs.cpSync(EXT, dir, { recursive: true });
  const first = path.join(dir, 'shared.js');
  const shim = `// TEST SHIM: screen coordinates are junk in this copy
for (const k of ['screenX', 'screenY']) {
  Object.defineProperty(MouseEvent.prototype, k, { configurable: true, get() { return Math.random() * 5000; } });
}
`;
  fs.writeFileSync(first, shim + fs.readFileSync(first, 'utf8'));
  return dir;
}

export function suite(name, timeoutMs = 180000) {
  const results = [];
  console.log(`\n== ${name} ==`);
  const timer = setTimeout(() => { console.error(`TIMED OUT after ${timeoutMs / 1000}s`); process.exit(1); }, timeoutMs);
  const check = (label, ok, info = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${info ? '  ' + info : ''}`);
  };
  const finish = async (...browsers) => {
    clearTimeout(timer);
    const passed = results.filter(Boolean).length;
    console.log(`\n${name}: ${passed}/${results.length} passed`);
    for (const b of browsers) { try { await b.close(); } catch (_) {} }
    for (const s of servers) s.close();
    process.exit(passed === results.length ? 0 : 1);
  };
  return { check, finish };
}
