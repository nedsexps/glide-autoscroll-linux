// Builds the file to upload to the Chrome Web Store: the extension folder's contents,
// manifest.json at the root, nothing else (no tests, no hidden files).
//   node store-zip.mjs   ->   ../glide-autoscroll-store/glide-autoscroll-<version>-chrome-web-store.zip
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EXT, HERE } from './lib.mjs';
import { crc32 } from './png.mjs';

const KEEP = new Set(['.json', '.js', '.html', '.css', '.png', '.svg']);
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const out = path.join(HERE, '..', 'glide-autoscroll-store', `glide-autoscroll-${manifest.version}-chrome-web-store.zip`);

function list(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.'))
    .flatMap(d => d.isDirectory() ? list(path.join(dir, d.name), `${prefix}${d.name}/`)
      : KEEP.has(path.extname(d.name)) ? [`${prefix}${d.name}`] : [])
    .sort();
}

const files = list(EXT);
if (!files.includes('manifest.json')) throw new Error('manifest.json missing from the extension folder');
// fixed timestamp so the same code always gives the same zip
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 11;
const local = [], central = [];
let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(EXT, name));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, nameBuf, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28);
  c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
  central.push(c, nameBuf);
  offset += h.length + nameBuf.length + packed.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`${path.basename(out)}  (${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
for (const f of files) console.log(`  ${f}`);
