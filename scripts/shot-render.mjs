// Vývojový nástroj: výstřely z GameAudio vyrenderované offline do WAV (poslech a porovnání).
// Použití: node scripts/shot-render.mjs <výstupní složka> [předpona]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, prefix = 'shot'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:5173/viewer.html');
const res = await p.evaluate(async () => {
  const { GameAudio } = await import('/src/client/runtime/audio.ts');
  const kinds = ['rifle', 'sniper', 'pistol', 'shotgun', 'mg'];
  const outp = {};
  for (const kind of kinds) {
    const sr = 48000, len = sr * 1.6;
    const Off = class extends OfflineAudioContext { constructor() { super(2, len, sr); } resume() { return Promise.resolve(); } };
    window.AudioContext = Off;
    const a = new GameAudio();
    a.load = async () => {};
    a.unlock();
    a.volume = 0.6;
    a.shot(kind);
    const buf = await a.ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    // Obálka (RMS po 10 ms) a špička.
    let peak = 0;
    const env = [];
    for (let i = 0; i < L.length; i += 480) {
      let s = 0;
      for (let j = i; j < Math.min(L.length, i + 480); j++) { s += L[j] * L[j]; peak = Math.max(peak, Math.abs(L[j])); }
      env.push(Math.sqrt(s / 480));
    }
    // 16bit WAV.
    const n = L.length, wav = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o, str) => [...str].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
    wav.setUint32(24, sr, true); wav.setUint32(28, sr * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); w(36, 'data'); wav.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    let bin = ''; const u8 = new Uint8Array(wav.buffer); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
    const db = (x) => (20 * Math.log10(Math.max(1e-6, x))).toFixed(1);
    const at = (ms) => db(env[Math.floor(ms / 10)] ?? 0);
    outp[kind] = { wav: btoa(bin), peak: db(peak), rms: { '0-10ms': at(0), '50ms': at(50), '150ms': at(150), '300ms': at(300), '600ms': at(600) } };
  }
  return outp;
});
for (const [k, v] of Object.entries(res)) {
  fs.writeFileSync(`${out}/${prefix}-${k}.wav`, Buffer.from(v.wav, 'base64'));
  console.log(k, 'špička', v.peak, 'dB  RMS', JSON.stringify(v.rms));
}
await b.close();
