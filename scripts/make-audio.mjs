#!/usr/bin/env node
// Procedural night soundscape, synthesised from scratch (no samples, no licensing):
// wind, crickets, a deep drone, plus a whoosh for every meteor and a rumble for every fireball,
// panned by where the meteor actually appears on screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchedule, cameraAt, camBasis, mulberry32, V, clamp, smooth, headCurve } from '../web/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const outFile = arg('out', 'audio.wav');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const SR = 44100, T = cfg.video.duration, N = Math.floor(SR * T);
const L = new Float32Array(N), R = new Float32Array(N);
const rng = mulberry32(cfg.seed ^ 0xA0D10);
const TAU = Math.PI * 2;

// --- wind: two slow-filtered noise streams with a swelling envelope ---
{
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const swell = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * t / 19 + 1)) * (0.6 + 0.4 * Math.sin(TAU * t / 47));
    const wl = rng() * 2 - 1, wr = rng() * 2 - 1;
    l1 += 0.012 * (wl - l1); l2 += 0.05 * (l1 * 6 - l2);
    r1 += 0.012 * (wr - r1); r2 += 0.05 * (r1 * 6 - r2);
    L[i] += l2 * 0.55 * swell; R[i] += r2 * 0.55 * swell;
  }
}
// --- crickets: several voices chirping in pulse trains ---
{
  const voices = Array.from({ length: 7 }, () => ({ f: 3900 + rng() * 1500, rate: 24 + rng() * 14, grp: 0.25 + rng() * 0.5, ph: rng() * 6, pan: rng() * 2 - 1, amp: 0.004 + rng() * 0.004 }));
  for (const v of voices) {
    let phase = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const gate = Math.max(0, Math.sin(TAU * v.rate * t + v.ph)) ** 0.7 * smooth(-0.15, 0.25, Math.sin(TAU * v.grp * t + v.ph * 3));
      if (gate < 1e-3) continue;
      phase += TAU * v.f / SR;
      const s = Math.sin(phase) * gate * v.amp * (0.6 + 0.4 * Math.sin(TAU * t / 31 + v.ph));
      L[i] += s * (1 - v.pan) * 0.5 + s * 0.25; R[i] += s * (1 + v.pan) * 0.5 + s * 0.25;
    }
  }
}
// --- drone pad ---
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const lfo = 0.6 + 0.4 * Math.sin(TAU * t / 23);
  const d = (Math.sin(TAU * 55 * t) * 0.5 + Math.sin(TAU * 55.2 * t) * 0.3 + Math.sin(TAU * 82.4 * t + 1) * 0.25 + Math.sin(TAU * 110.3 * t) * 0.12) * 0.05 * lfo * smooth(0, 8, t);
  const sh = (Math.sin(TAU * 659.3 * t) * 0.5 + Math.sin(TAU * 880.5 * t + 2) * 0.4) * 0.0022 * (0.5 + 0.5 * Math.sin(TAU * t / 13 + 2)) * smooth(10, 40, t);
  L[i] += d + sh; R[i] += d + sh * 0.8;
}

// --- meteor & fireball sounds ---
const { events } = buildSchedule(cfg);
function noiseBand(i0, n, env, pan, fc0, fc1, q, gain, lowpass = false) {
  let low = 0, band = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k; if (i < 0 || i >= N) continue;
    const x = k / n, fc = fc0 + (fc1 - fc0) * x, f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    const w = rng() * 2 - 1;
    const high = w - low - q * band; band += f * high; low += f * band;
    const s = (lowpass ? low : band) * env(x) * gain;
    L[i] += s * Math.sqrt((1 - pan) / 2) * 1.414; R[i] += s * Math.sqrt((1 + pan) / 2) * 1.414;
  }
}
for (const e of events) {
  const { az, pitch } = cameraAt(cfg, e.t0 + e.dur / 2);
  const b = camBasis(az, pitch);
  const mid = V.norm(V.add(e.A, e.B));
  const pan = clamp(V.dot(mid, b.r) / (V.dot(mid, b.f) || 1) / 1.4, -1, 1);
  const i0 = Math.floor(e.t0 * SR), dur = e.dur + e.lag;
  if (e.kind === 'streak') {
    const g = 0.05 * e.bright;
    noiseBand(i0, Math.floor(dur * SR), (x) => smooth(0, 0.15, x) * (1 - x) ** 1.8, pan, 5200, 2200, 0.35, g);
  } else {
    const big = e.kind === 'super', g = big ? 1.0 : 0.6;
    noiseBand(i0, Math.floor((dur + 0.8) * SR), (x) => smooth(0, 0.25, x) * (1 - x) ** 1.4, pan, 3200, 900, 0.3, 0.08 * g);
    noiseBand(i0 + Math.floor(0.3 * SR), Math.floor((e.dur + (big ? 7 : 4)) * SR), (x) => smooth(0, 0.3, x) * (1 - x) ** 2.2, pan, 150, 70, 1.2, 1.1 * g, true);
    for (let c = 0; c < (big ? 90 : 40); c++) { // crackle
      const ts = i0 + Math.floor((rng() * e.dur * 1.4) * SR), len = Math.floor(SR * (0.004 + rng() * 0.012)), p = clamp(pan + (rng() - 0.5) * 0.4, -1, 1), a = (0.02 + rng() * 0.05) * g;
      for (let k = 0; k < len && ts + k < N; k++) { const s = (rng() * 2 - 1) * a * Math.exp(-k / (len * 0.3)); L[ts + k] += s * (1 - p) * 0.5; R[ts + k] += s * (1 + p) * 0.5; }
    }
    if (big) { // delayed "sonic boom" thump
      const ts = i0 + Math.floor((e.dur + 1.6) * SR);
      for (let k = 0; k < SR * 2.5 && ts + k < N; k++) { const t = k / SR, s = Math.sin(TAU * (38 + 30 * Math.exp(-t * 6)) * t) * Math.exp(-t * 1.6) * 0.55; L[ts + k] += s; R[ts + k] += s; }
    }
  }
}

// --- master: soft limiter, fades, write 16-bit WAV ---
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = smooth(0, 3, t) * (1 - smooth(T - 8, T - 0.2, t));
  pcm.writeInt16LE(Math.round(Math.tanh(L[i] * 1.25) * 0.88 * fade * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.tanh(R[i] * 1.25) * 0.88 * fade * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(outFile, Buffer.concat([hdr, pcm]));
console.log(`wrote ${outFile}: ${T}s, ${events.length} meteor sounds`);
