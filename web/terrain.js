import * as THREE from 'three';
import { mulberry32, DEG } from './shared.js';

function hash2(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vn(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, s, o = 5) {
  let a = 0.5, sum = 0, n = 0;
  for (let i = 0; i < o; i++) { sum += a * vn(x, y, s + i); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; }
  return sum / n;
}
function ridged(x, y, s, o = 5) {
  let sum = 0, a = 0.5, w = 1, n = 0;
  for (let i = 0; i < o; i++) {
    let v = 1 - Math.abs(2 * vn(x, y, s + i) - 1); v *= v; v *= w;
    w = Math.min(1, Math.max(0, v * 1.6));
    sum += v * a; n += a; x = x * 2.1 + 11.3; y = y * 2.1 + 5.9; a *= 0.5;
  }
  return sum / n;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function heightAt(x, z, seed = 7) {
  const r = Math.hypot(x, z);
  // distant mountain ranges (a few km tall, 20-60 km away)
  const f1 = Math.pow(ridged(x / 11000 + 3.1, z / 11000 - 1.7, seed) * 1.65, 1.7);
  const far = 4200 * f1 * sstep(6000, 24000, r) * (1 - sstep(48000, 80000, r));
  // mid foothills
  const f2 = Math.pow(ridged(x / 1700 + 9.4, z / 1700 + 2.2, seed + 40) * 1.5, 1.5);
  const mid = 0.065 * r * f2 * sstep(500, 2600, r) * (1 - sstep(9000, 22000, r));
  // near rolling ground: observer stands on a small knoll
  const near = 2.4 * (fbm(x / 70, z / 70, seed + 80) - 0.5) + 10 * (fbm(x / 420, z / 420, seed + 90) - 0.5) * sstep(10, 220, r)
    - 7 * sstep(5, 160, r);
  return near + mid + far;
}

export function buildTerrain() {
  const NR = 230, NA = 1024, r0 = 12, r1 = 80000;
  const pos = new Float32Array((NR + 1) * (NA + 1) * 3), nor = new Float32Array(pos.length);
  let k = 0;
  for (let i = 0; i <= NR; i++) {
    const r = r0 * Math.pow(r1 / r0, i / NR);
    const e = Math.max(1.5, r * 0.003);
    for (let j = 0; j <= NA; j++) {
      const az = (j / NA) * Math.PI * 2;
      const x = r * Math.sin(az), z = -r * Math.cos(az);
      const h = heightAt(x, z);
      const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
      const nx = -hx / (2 * e), nz = -hz / (2 * e), il = 1 / Math.hypot(nx, 1, nz);
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      nor[k] = nx * il; nor[k + 1] = il; nor[k + 2] = nz * il;
      k += 3;
    }
  }
  const idx = new Uint32Array(NR * NA * 6);
  let q = 0;
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Silhouetted pines framing the shot
function pineGeometry(rng) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 6); trunk.translate(0, 1.1, 0); parts.push(trunk);
  const layers = 9;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const rad = 2.7 * (1 - t) + 0.35, h = 2.3 - t * 0.8;
    const c = new THREE.ConeGeometry(rad, h, 9, 1);
    const p = c.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v);
      if (y < h * 0.2) { const j = 0.75 + rng() * 0.5; p.setX(v, p.getX(v) * j); p.setZ(v, p.getZ(v) * j); }
    }
    c.translate(0, 2.0 + t * 8.2, 0); parts.push(c);
  }
  const top = new THREE.ConeGeometry(0.25, 2.2, 6); top.translate(0, 12.0, 0); parts.push(top);
  let total = 0; parts.forEach((p) => (total += p.index ? p.index.count : p.attributes.position.count));
  const P = [], I = []; let off = 0;
  for (const p of parts) {
    const a = p.attributes.position;
    for (let v = 0; v < a.count; v++) P.push(a.getX(v), a.getY(v), a.getZ(v));
    const ix = p.index;
    for (let t = 0; t < ix.count; t++) I.push(ix.getX(t) + off);
    off += a.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

export function buildTrees(cfg, material) {
  const rng = mulberry32(cfg.seed ^ 0x7EE5);
  const mid = (cfg.camera.azStart + cfg.camera.azEnd) / 2;
  const geo = pineGeometry(rng);
  const items = [];
  const cluster = (azC, azW, n, d0, d1) => {
    for (let i = 0; i < n; i++) {
      const az = (azC + (rng() * 2 - 1) * azW) * DEG, d = d0 + rng() * (d1 - d0);
      const x = d * Math.sin(az), z = -d * Math.cos(az);
      items.push({ x, z, s: 0.7 + rng() * 0.9, ry: rng() * 6.28, lean: (rng() - 0.5) * 0.06 });
    }
  };
  cluster(mid - 50, 20, 16, 18, 62);
  cluster(mid + 52, 20, 15, 16, 55);
  cluster(mid + 170, 40, 12, 25, 70); // behind the observer, in case of a turn
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  items.forEach((it, i) => {
    e.set(it.lean, it.ry, it.lean * 0.7); q.setFromEuler(e);
    m.compose(new THREE.Vector3(it.x, heightAt(it.x, it.z) - 0.4, it.z), q, new THREE.Vector3(it.s, it.s * (0.9 + rng() * 0.4), it.s));
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  return mesh;
}
