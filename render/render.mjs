#!/usr/bin/env node
// Frame-exact renderer: drives headless Chrome (WebGL2 via SwiftShader), pipes JPEG frames into ffmpeg.
//
//   node render/render.mjs --still 20,120,640        -> PNG stills in ./stills
//   node render/render.mjs --shard 0 --shards 20     -> render one shard of the film as mp4 segments
//   node render/render.mjs --frames 0-299 --out out  -> render an explicit frame range
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = (() => {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  return o;
})();

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PRESETS = {
  full: {},
  preview: { video: { width: 960, height: 540, fps: 15 }, quality: { milkyWayBake: 2048, msaa: 0, starCount: 9000, jpegQuality: 0.85 } },
};
const preset = PRESETS[args.preset || 'full'];
const opts = { video: { ...preset.video }, quality: { ...preset.quality } };
if (args.width) opts.video.width = +args.width;
if (args.height) opts.video.height = +args.height;
if (args.fps) opts.video.fps = +args.fps;
if (args.msaa) opts.quality.msaa = +args.msaa;
const V = { ...cfg.video, ...opts.video };
const TOTAL = Math.round(V.fps * V.duration);
const SEG = +(args.segment || 450);
const CRF = args.crf || process.env.CRF || '16';

// ---------- static server ----------
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (p === '/') p = '/index.html';
    if (p === '/config.json') file = path.join(ROOT, 'config.json');
    else if (p.startsWith('/three/')) file = path.join(ROOT, 'node_modules/three', p.slice(7));
    else file = path.join(ROOT, 'web', p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// ---------- browser ----------
async function findChrome() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  try { const m = await import('@sparticuz/chromium'); return await m.default.executablePath(); }
  catch { throw new Error('No Chrome found. Set CHROME_PATH to a Chrome/Chromium binary.'); }
}
async function launch(url) {
  const browser = await puppeteer.launch({
    executablePath: await findChrome(), headless: 'shell', protocolTimeout: 30 * 60 * 1000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.error('[page]', m.text().slice(0, 400)); });
  await page.setViewport({ width: 320, height: 180 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  const t0 = Date.now();
  const info = await page.evaluate((o) => window.init(o), opts);
  console.log(`scene ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(info));
  return { browser, page };
}

// ---------- ffmpeg segment encoder ----------
function startFfmpeg(file) {
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(V.fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', args.preset === 'preview' ? 'veryfast' : 'medium', '-crf', String(CRF), '-profile:v', 'high', '-g', String(V.fps * 2),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(V.fps), '-movflags', '+faststart', file],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))); ff.on('error', rej); });
  ff.stdin.on('error', () => {});
  return { ff, done };
}

async function renderSegment(page, a, b, file) {
  const tmp = file + '.part.mp4';
  const { ff, done } = startFfmpeg(tmp);
  const t0 = Date.now();
  try {
    for (let f = a; f < b; f++) {
      const url = await page.evaluate((i) => window.renderFrame(i), f);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      const n = f - a + 1;
      if (n % 30 === 0 || f === b - 1) {
        const el = (Date.now() - t0) / 1000;
        console.log(`  frames ${a}-${b - 1}: ${n}/${b - a}  ${(el / n).toFixed(2)} s/frame  eta ${(((b - a - n) * el) / n / 60).toFixed(1)} min`);
      }
    }
    ff.stdin.end();
    await done;
    fs.renameSync(tmp, file);
  } catch (e) { try { ff.kill('SIGKILL'); } catch {} throw e; }
}

// ---------- main ----------
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
let session = null;
try {
  if (args.still) {
    fs.mkdirSync(args.out || 'stills', { recursive: true });
    session = await launch(url);
    for (const s of String(args.still).split(',')) {
      const t = parseFloat(s), t0 = Date.now();
      const u = await session.page.evaluate((x) => window.renderStill(x), t);
      const f = path.join(args.out || 'stills', `t${String(Math.round(t * 10)).padStart(5, '0')}.png`);
      fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64'));
      console.log(`t=${t}s -> ${f}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  } else {
    const out = args.out || 'out';
    fs.mkdirSync(out, { recursive: true });
    let a0 = 0, b0 = TOTAL;
    if (args.frames) { [a0, b0] = String(args.frames).split('-').map(Number); b0 += 1; }
    else if (args.shards) { const n = +args.shards, k = +args.shard; a0 = Math.round((TOTAL * k) / n); b0 = Math.round((TOTAL * (k + 1)) / n); }
    console.log(`Rendering frames ${a0}..${b0 - 1} of ${TOTAL} (${V.width}x${V.height} @ ${V.fps}fps, crf ${CRF})`);
    for (let a = a0; a < b0; a += SEG) {
      const b = Math.min(b0, a + SEG);
      const file = path.join(out, `seg_${String(a).padStart(6, '0')}.mp4`);
      if (fs.existsSync(file)) { console.log('skip existing', file); continue; }
      for (let attempt = 1; ; attempt++) {
        try {
          if (!session) session = await launch(url);
          await renderSegment(session.page, a, b, file);
          break;
        } catch (e) {
          console.error(`segment ${a} failed (attempt ${attempt}):`, e.message);
          try { await session?.browser.close(); } catch {}
          session = null;
          if (attempt >= 3) throw e;
        }
      }
      console.log('wrote', file);
    }
  }
} finally {
  try { await session?.browser.close(); } catch {}
  server.close();
}
