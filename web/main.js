import * as THREE from 'three';
import {
  DEG, clamp, lerp, smooth, V, mulberry32, celestialMatrix, cameraAt, camBasis, buildSchedule, buildSparks,
  slerpDir, headCurve, SKY_DIST,
} from './shared.js';
import { buildStars } from './stars.js';
import { buildTerrain, buildTrees } from './terrain.js';
import * as SH from './shaders.js';

const MAX_RIB = 200, MAX_DOTS = 2600;
let ST = null;

window.init = async function (opts = {}) {
  const cfg = await (await fetch('/config.json')).json();
  cfg.video = { ...cfg.video, ...(opts.video || {}) };
  cfg.quality = { ...cfg.quality, ...(opts.quality || {}) };
  const W = cfg.video.width, H = cfg.video.height;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 1);
  const gl = renderer.getContext();

  const U = {
    uTime: { value: 0 }, uPollution: { value: cfg.sky.pollution }, uPollAz: { value: cfg.sky.pollutionAzimuth * DEG },
    uAirglow: { value: cfg.sky.airglow }, uFlash: { value: 0 }, uFlashTint: { value: new THREE.Vector3(1, 0.8, 0.6) },
    uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uGroundLight: { value: cfg.quality.groundLight },
    uCel: { value: new THREE.Matrix3() }, uWorldToEq: { value: new THREE.Matrix3() },
    uRes: { value: new THREE.Vector2(W, H) },
  };
  const eye = new THREE.Vector3(0, cfg.camera.eyeHeight, 0);
  const camera = new THREE.PerspectiveCamera(cfg.camera.fovDeg, W / H, 0.3, 1e6);
  camera.position.copy(eye);
  const scene = new THREE.Scene();
  const dummyCam = new THREE.Camera();

  // ---------- Fullscreen pass helper ----------
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const makePass = (frag, uniforms) => {
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SH.FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(triGeo, mat); mesh.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(mesh);
    return { sc, mat };
  };
  const runPass = (p, target) => { renderer.setRenderTarget(target); renderer.render(p.sc, dummyCam); };

  // ---------- Milky Way bake (tiled so no single draw is huge) ----------
  const mwW = cfg.quality.milkyWayBake, mwH = mwW / 2;
  const mwRT = new THREE.WebGLRenderTarget(mwW, mwH, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  mwRT.texture.wrapS = THREE.RepeatWrapping; mwRT.texture.wrapT = THREE.ClampToEdgeWrapping; mwRT.texture.generateMipmaps = false;
  {
    const bake = new THREE.ShaderMaterial({ uniforms: { uSize: { value: new THREE.Vector2(mwW, mwH) } }, vertexShader: SH.FS_VERT, fragmentShader: SH.MW_BAKE_FRAG, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(triGeo, bake); mesh.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(mesh);
    const TILES = 8, th = mwH / TILES;
    renderer.setRenderTarget(mwRT);
    mwRT.scissorTest = true;
    for (let i = 0; i < TILES; i++) { mwRT.scissor.set(0, i * th, mwW, th); renderer.render(sc, dummyCam); gl.finish(); }
    mwRT.scissorTest = false;
    renderer.setRenderTarget(null);
    bake.dispose();
  }

  // ---------- Sky dome ----------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uMW: { value: mwRT.texture }, uMWGain: { value: cfg.sky.milkyWayGain } },
    vertexShader: SH.SKY_VERT, fragmentShader: SH.SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9e5, 48, 24), skyMat);
  sky.renderOrder = -100; sky.frustumCulled = false; sky.position.copy(eye);
  scene.add(sky);

  // ---------- Stars ----------
  const rngStars = mulberry32(cfg.seed);
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uCel: U.uCel, uTime: U.uTime, uStarGain: { value: 1.0 } },
    vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(buildStars(cfg, rngStars, U), starMat);
  stars.frustumCulled = false; stars.renderOrder = -90;
  scene.add(stars);

  // ---------- Terrain + trees ----------
  const terrainMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SH.TERRAIN_VERT, fragmentShader: SH.TERRAIN_FRAG });
  const terrain = new THREE.Mesh(buildTerrain(), terrainMat); terrain.frustumCulled = false;
  scene.add(terrain);
  const treeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.0007, 0.0010, 0.0018, THREE.LinearSRGBColorSpace) });
  treeMat.toneMapped = false;
  scene.add(buildTrees(cfg, treeMat));

  // ---------- Meteor ribbons ----------
  const rg = new THREE.InstancedBufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  rg.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2));
  rg.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIB * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const rib = { head: mk(3), tail: mk(3), A: mk(4), B: mk(4), col: mk(3) };
  rg.setAttribute('aHead', rib.head); rg.setAttribute('aTail', rib.tail); rg.setAttribute('aA', rib.A); rg.setAttribute('aB', rib.B); rg.setAttribute('aCol', rib.col);
  rg.instanceCount = 0;
  const ribMat = new THREE.ShaderMaterial({
    uniforms: { uRes: U.uRes, uTime: U.uTime }, vertexShader: SH.METEOR_VERT, fragmentShader: SH.METEOR_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const ribMesh = new THREE.Mesh(rg, ribMat); ribMesh.frustumCulled = false; ribMesh.renderOrder = 10;
  scene.add(ribMesh);

  // ---------- Dots (sparks, satellites) ----------
  const dg = new THREE.BufferGeometry();
  const dPos = new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3), dSize = new THREE.BufferAttribute(new Float32Array(MAX_DOTS), 1), dCol = new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
  [dPos, dSize, dCol].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
  dg.setAttribute('position', dPos); dg.setAttribute('aSize', dSize); dg.setAttribute('aCol', dCol);
  dg.setDrawRange(0, 0);
  const dotMat = new THREE.ShaderMaterial({ vertexShader: SH.DOT_VERT, fragmentShader: SH.DOT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const dots = new THREE.Points(dg, dotMat); dots.frustumCulled = false; dots.renderOrder = 11;
  scene.add(dots);

  // ---------- Schedule ----------
  const sched = buildSchedule(cfg);
  const sparks = buildSparks(cfg, sched.events);

  // ---------- Post chain ----------
  const hdr = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  const rtType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const sceneRT = new THREE.WebGLRenderTarget(W, H, { type: rtType, samples: cfg.quality.msaa || 0, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const levels = [];
  for (let i = 0, w = W, h = H; i < 6; i++) {
    w = Math.max(2, Math.floor(w / 2)); h = Math.max(2, Math.floor(h / 2));
    const mkRT = () => new THREE.WebGLRenderTarget(w, h, { type: rtType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    levels.push({ w, h, down: mkRT(), up: mkRT() });
  }
  const downPass = makePass(SH.DOWN_FRAG, { tex: { value: null }, texel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
  const upPass = makePass(SH.UP_FRAG, { tex: { value: null }, base: { value: null }, texel: { value: new THREE.Vector2() }, uMix: { value: 0.9 } });
  const compU = { tScene: { value: sceneRT.texture }, tBloom: { value: null }, uRes: U.uRes, uBloom: { value: cfg.quality.bloom }, uExposure: { value: cfg.quality.exposure }, uFade: { value: 1 }, uSeed: { value: 0 } };
  const comp = makePass(SH.COMPOSITE_FRAG, compU);

  const out2d = document.createElement('canvas'); out2d.width = W; out2d.height = H;
  const ctx = out2d.getContext('2d');

  ST = { cfg, W, H, renderer, scene, camera, U, eye, sched, sparks, rib, rg, dg, dPos, dSize, dCol, levels, downPass, upPass, comp, compU, runPass, sceneRT, ctx, out2d, hdr };
  return { hdr: !!hdr, events: sched.events.length, sparks: sparks.length, renderer: gl.getParameter(gl.RENDERER) };
};

// ---------------------------------------------------------------------------
function updateMeteors(t) {
  const { sched, sparks, rib, rg, dg, dPos, dSize, dCol, U, eye } = ST;
  const ox = eye.x, oy = eye.y, oz = eye.z;
  let n = 0;
  const put = (head, tail, w, hr, hb, tb, seed, train, flick, col) => {
    if (n >= MAX_RIB) return;
    const i3 = n * 3, i4 = n * 4;
    rib.head.array.set([ox + head[0] * SKY_DIST, oy + head[1] * SKY_DIST, oz + head[2] * SKY_DIST], i3);
    rib.tail.array.set([ox + tail[0] * SKY_DIST, oy + tail[1] * SKY_DIST, oz + tail[2] * SKY_DIST], i3);
    rib.A.array.set([w, hr, hb, tb], i4); rib.B.array.set([seed, train, flick, 0], i4); rib.col.array.set(col, i3);
    n++;
  };
  let flash = 0, flashDir = [0, 1, 0], flashTint = [1, 0.8, 0.6], flashBest = 0;
  for (const e of sched.events) {
    if (t < e.t0 - 0.1) break;
    const end = e.t0 + e.dur + Math.max(e.lag, e.trainDur || 0) + 0.5;
    if (t > end) continue;
    const ph = clamp((t - e.t0) / e.dur), pt = clamp((t - e.t0 - e.lag) / e.dur);
    const alive = t < e.t0 + e.dur;
    const head = slerpDir(e.A, e.B, ph, e.omega), tail = slerpDir(e.A, e.B, pt, e.omega);
    const post = t - e.t0 - e.dur;
    if (t >= e.t0 && (alive || post < e.lag)) {
      const lc = headCurve(e, ph);
      const headFade = alive ? clamp((e.t0 + e.dur - t) / 0.07) : 0;
      const hb = e.bright * lc * headFade;
      const tfade = alive ? 1 : Math.pow(clamp(1 - post / e.lag), 1.5);
      const tb = e.bright * (0.35 + 0.6 * Math.min(1, lc)) * tfade * 0.95;
      if (ph > pt) put(head, tail, e.width, e.headR * (0.8 + 0.2 * Math.min(1.5, lc)), hb, tb, e.seed, 0, e.flicker, e.tint);
    }
    if (e.trainDur > 0 && t >= e.t0 + 0.1) {
      const tau = e.trainDur / 3.5;
      const f = smooth(e.t0, e.t0 + 0.5, t) * (alive ? 1 : Math.exp(-post / tau));
      if (f > 0.01) put(slerpDir(e.A, e.B, ph, e.omega), e.A, e.width * 1.6, 0, 0, e.trainBright * f, e.seed, 1, 0, [0.45, 0.95, 0.75]);
    }
    if (e.flash > 0) {
      const x = (t - e.t0) / e.dur;
      let l = 0;
      if (x >= 0 && x <= 1) l = headCurve(e, x) * 0.6;
      else if (x > 1) l = Math.exp(-(x - 1) * (e.kind === 'super' ? 1.5 : 4)) * 0.45;
      const v = e.flash * Math.min(1.3, l);
      flash += v;
      if (v > flashBest) { flashBest = v; flashDir = head; flashTint = e.flashTint || flashTint; }
    }
  }
  rg.instanceCount = n;
  for (const a of Object.values(rib)) a.needsUpdate = true;
  U.uFlash.value = Math.min(flash, 1.2);
  U.uFlashDir.value.set(flashDir[0], Math.max(flashDir[1], 0.2), flashDir[2]);
  U.uFlashTint.value.set(flashTint[0], flashTint[1], flashTint[2]);

  // ---- dots ----
  let d = 0;
  const addDot = (p, size, c) => {
    if (d >= MAX_DOTS) return;
    dPos.array[d * 3] = ox + p[0] * SKY_DIST; dPos.array[d * 3 + 1] = oy + p[1] * SKY_DIST; dPos.array[d * 3 + 2] = oz + p[2] * SKY_DIST;
    dSize.array[d] = size; dCol.array.set(c, d * 3); d++;
  };
  for (const s of sparks) {
    const e = s.e, t0 = e.t0 + s.pB * e.dur, age = t - t0;
    if (age < 0 || age > s.life) continue;
    const H = slerpDir(e.A, e.B, s.pB, e.omega);
    let a1 = V.cross(H, [0, 1, 0]); if (V.len(a1) < 1e-3) a1 = [1, 0, 0]; a1 = V.norm(a1);
    const a2 = V.cross(H, a1);
    const off = V.add(V.mul(a1, Math.cos(s.ang)), V.mul(a2, Math.sin(s.ang)));
    const p = V.norm(V.add(V.add(H, V.mul(off, s.speed * age)), [0, -0.5 * 0.01 * age * age, 0]));
    const k = age / s.life, inten = s.heat * Math.pow(1 - k, 1.6) * (0.75 + 0.25 * Math.sin(age * 40 + s.seed * 50));
    const c = [lerp(1.0, 1.0, k) * inten, lerp(0.8, 0.22, k) * inten, lerp(0.5, 0.06, k) * inten];
    addDot(p, s.size * (1 - 0.4 * k), c);
  }
  for (const s of sched.sats) {
    if (t < s.t0 || t > s.t0 + s.dur) continue;
    const p = (t - s.t0) / s.dur;
    const pos = slerpDir(s.A, s.B, p, s.omega);
    const fade = smooth(0, 0.04, p) * (1 - smooth(0.86, 0.97, p));
    const b = 0.9 * fade * (0.78 + 0.22 * Math.sin(t * 1.7 + s.seed * 30));
    addDot(pos, 3.2, [b, b * 0.95, b * 0.85]);
  }
  dg.setDrawRange(0, d);
  dPos.needsUpdate = dSize.needsUpdate = dCol.needsUpdate = true;
}

function drawOverlays(ctx, t, cfg) {
  const W = ST.W, H = ST.H, T = cfg.video.duration, k = W / 1920;
  const font = (w, s) => `${w} ${s * k}px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif`;
  const fadeA = (t0, t1) => Math.min(smooth(t0, t0 + 1.2, t), 1 - smooth(t1 - 1.2, t1, t));
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const o of cfg.overlays || []) {
    const t0 = o.t0 < 0 ? T + o.t0 : o.t0, t1 = o.t1 < 0 ? T + o.t1 : o.t1;
    const a = fadeA(t0, t1);
    if (a <= 0.003) continue;
    ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(120,170,255,0.55)'; ctx.shadowBlur = 24 * k;
    if (o.style === 'title') {
      ctx.textAlign = 'center';
      ctx.letterSpacing = `${18 * k}px`; ctx.font = font(200, 64);
      ctx.fillText(o.main, W / 2 + 9 * k, H * 0.40);
      ctx.shadowBlur = 8 * k; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(W / 2 - 90 * k, H * 0.40 + 34 * k, 180 * k, 1.5 * k);
      ctx.letterSpacing = `${9 * k}px`; ctx.font = font(300, 22);
      ctx.fillText(o.sub, W / 2 + 4.5 * k, H * 0.40 + 84 * k);
    } else {
      ctx.textAlign = 'left';
      ctx.letterSpacing = `${12 * k}px`; ctx.font = font(300, 34);
      ctx.fillText(o.main, 90 * k, H - 130 * k);
      ctx.shadowBlur = 6 * k; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.letterSpacing = `${5 * k}px`; ctx.font = font(300, 19);
      ctx.fillText(o.sub, 90 * k, H - 92 * k);
    }
  }
  if (cfg.watermark) {
    ctx.globalAlpha = 0.32 * smooth(20, 24, t) * (1 - smooth(T - 12, T - 8, t));
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
    ctx.letterSpacing = `${5 * k}px`; ctx.font = font(300, 15);
    ctx.fillText(cfg.watermark, W - 60 * k, H - 48 * k);
  }
  ctx.restore();
}

function renderAt(t, frame) {
  const S = ST, { cfg, renderer, scene, camera, U, eye, levels, downPass, upPass, comp, compU, runPass, sceneRT } = S;
  const { az, pitch } = cameraAt(cfg, t);
  const b = camBasis(az, pitch);
  camera.position.copy(eye);
  camera.lookAt(eye.x + b.f[0], eye.y + b.f[1], eye.z + b.f[2]);
  camera.updateMatrixWorld(true);

  const M = celestialMatrix(cfg, t);
  U.uCel.value.set(...M);
  U.uWorldToEq.value.copy(U.uCel.value).transpose();
  U.uTime.value = t;
  updateMeteors(t);

  // scene -> HDR target
  renderer.setRenderTarget(sceneRT);
  renderer.clear();
  renderer.render(scene, camera);

  // bloom pyramid
  let src = sceneRT.texture, sw = S.W, sh = S.H;
  levels.forEach((L, i) => {
    downPass.mat.uniforms.tex.value = src;
    downPass.mat.uniforms.texel.value.set(1 / sw, 1 / sh);
    downPass.mat.uniforms.uKaris.value = i === 0 ? 1 : 0;
    runPass(downPass, L.down);
    src = L.down.texture; sw = L.w; sh = L.h;
  });
  let prev = levels[levels.length - 1].down;
  for (let i = levels.length - 2; i >= 0; i--) {
    upPass.mat.uniforms.tex.value = prev.texture;
    upPass.mat.uniforms.base.value = levels[i].down.texture;
    upPass.mat.uniforms.texel.value.set(1 / levels[i + 1].w, 1 / levels[i + 1].h);
    runPass(upPass, levels[i].up);
    prev = levels[i].up;
  }
  compU.tBloom.value = prev.texture;
  compU.uFade.value = smooth(0, 3, t) * (1 - smooth(cfg.video.duration - 7, cfg.video.duration - 0.3, t));
  compU.uSeed.value = frame % 997;
  runPass(comp, null);
}

function output(t, mime, q) {
  ST.ctx.drawImage(ST.renderer.domElement, 0, 0);
  drawOverlays(ST.ctx, t, ST.cfg);
  return ST.out2d.toDataURL(mime, q);
}

window.renderFrame = (frame, mime = 'image/jpeg') => {
  const t = frame / ST.cfg.video.fps;
  renderAt(t, frame);
  return output(t, mime, ST.cfg.quality.jpegQuality);
};
window.renderStill = (t, mime = 'image/png') => { renderAt(t, Math.round(t * 30)); return output(t, mime, 0.95); };
window.__ready = true;
