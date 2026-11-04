/** Vývojový nástroj: vykreslí kontaktní arch procedurálních textur do PNG (náhled kvality). */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { RECIPES, generateTexture } from '../src/client/render/texgen';

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ids = process.argv[3] ? process.argv[3].split(',') : Object.keys(RECIPES);
const size = 256, cols = 6;
const mode = (process.argv[4] ?? 'albedo') as 'albedo' | 'normal' | 'orm';
const rows = Math.ceil(ids.length / cols);
const W = cols * size, H = rows * size;
const out = new Uint8Array(W * H * 4);
const t0 = Date.now();
ids.forEach((id, k) => {
  const t = generateTexture(id, size);
  const src = t[mode];
  const ox = (k % cols) * size, oy = Math.floor(k / cols) * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) out[((oy + y) * W + ox + x) * 4 + c] = src[(y * size + x) * 4 + c];
});
console.log('generated', ids.length, 'in', Date.now() - t0, 'ms');
writeFileSync(process.argv[2], png(W, H, out));
