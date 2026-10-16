// Shared between the browser renderer and the Node audio generator.
// Everything here is deterministic: same config + seed => same sky, same meteors.
export const DEG = Math.PI / 180;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};

// World axes: +X = East, +Y = Up, -Z = North. Azimuth 0 = North, 90 = East.
export const dirFromAzAlt = (azDeg, altDeg) => {
  const a = azDeg * DEG, h = altDeg * DEG;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
};
export const altOf = (d) => Math.asin(clamp(d[1], -1, 1)) / DEG;
export const azOf = (d) => ((Math.atan2(d[0], -d[2]) / DEG) + 360) % 360;

// ---------- Astronomy ----------
export const eqVec = (raDeg, decDeg) => {
  const a = raDeg * DEG, d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
};
// Equatorial J2000 -> Galactic rotation (rows)
export const M_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [+0.4941094279, -0.4448296300, +0.7469822445],
  [-0.8676661490, -0.1980763734, +0.4559837762],
];
export const galToEq = (g) => [
  M_GAL[0][0] * g[0] + M_GAL[1][0] * g[1] + M_GAL[2][0] * g[2],
  M_GAL[0][1] * g[0] + M_GAL[1][1] * g[1] + M_GAL[2][1] * g[2],
  M_GAL[0][2] * g[0] + M_GAL[1][2] * g[1] + M_GAL[2][2] * g[2],
];

export const julianDate = (iso) => Date.parse(iso) / 86400000 + 2440587.5;
export function lstDeg(cfg, t) {
  const jd = julianDate(cfg.startTime) + (t * cfg.timeLapse) / 86400;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  return (((g + cfg.location.lon) % 360) + 360) % 360;
}
// Row-major 3x3: celestial (equatorial) vector -> world vector, at video time t
export function celestialMatrix(cfg, t) {
  const L = lstDeg(cfg, t) * DEG, phi = cfg.location.lat * DEG;
  const cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(phi), sp = Math.sin(phi);
  return [-sL, cL, 0, cp * cL, cp * sL, sp, sp * cL, sp * sL, -cp];
}
export const applyM = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
export const radiantWorld = (cfg, t) => applyM(celestialMatrix(cfg, t), eqVec(cfg.radiant.raDeg, cfg.radiant.decDeg));

// ---------- Camera path ----------
export function cameraAt(cfg, t) {
  const c = cfg.camera, T = cfg.video.duration;
  const az = lerp(c.azStart, c.azEnd, smooth(0, T, t)) + 0.35 * Math.sin(t * 0.11) + 0.15 * Math.sin(t * 0.37 + 1);
  let pitch;
  if (t < 20) pitch = c.pitchIntro;
  else if (t < 75) pitch = lerp(c.pitchIntro, c.pitchMain, smooth(20, 75, t));
  else if (t < T - 70) pitch = c.pitchMain + 1.2 * Math.sin(t * 0.05);
  else pitch = lerp(c.pitchMain, c.pitchOutro, smooth(T - 70, T - 8, t));
  pitch += 0.12 * Math.sin(t * 0.23 + 2);
  return { az, pitch };
}
export function camBasis(az, pitch) {
  const f = dirFromAzAlt(az, pitch);
  const r = V.norm([-f[2], 0, f[0]]);
  const u = V.cross(r, f);
  return { f, r, u };
}

// ---------- Great-circle helpers ----------
export const rotateAlong = (P, T, ang) => V.add(V.mul(P, Math.cos(ang)), V.mul(T, Math.sin(ang)));
export function slerpDir(A, B, p, omega) {
  if (omega < 1e-5) return A;
  const s = Math.sin(omega);
  return V.add(V.mul(A, Math.sin((1 - p) * omega) / s), V.mul(B, Math.sin(p * omega) / s));
}

// ---------- Meteor schedule ----------
export const SKY_DIST = 3.0e5; // metres: far behind every mountain, in front of the stars

export function buildSchedule(cfg) {
  const rng = mulberry32(cfg.seed ^ 0x51ED);
  const T = cfg.video.duration;
  const aspect = cfg.video.width / cfg.video.height;
  const tanV = Math.tan((cfg.camera.fovDeg * DEG) / 2), tanH = tanV * aspect;
  const events = [];

  const viewPoint = (t, sh, sv) => {
    const { az, pitch } = cameraAt(cfg, t);
    const b = camBasis(az, pitch);
    const x = (rng() * 2 - 1) * sh * tanH, y = (rng() * 2 - 1) * sv * tanV;
    return V.norm(V.add(b.f, V.add(V.mul(b.r, x), V.mul(b.u, y))));
  };
  const finish = (e) => {
    e.omega = Math.acos(clamp(V.dot(e.A, e.B), -1, 1));
    events.push(e);
    return e;
  };
  const tintPick = () => {
    const r = rng();
    if (r < 0.68) return [0.82, 0.92, 1.0];
    if (r < 0.9) return [1.0, 0.80, 0.55];
    return [0.62, 1.0, 0.78];
  };

  // --- Ordinary meteors: Poisson process with a burst ---
  const m = cfg.meteors;
  const lam = (t) => m.baseRate + m.burstRate * Math.exp(-(((t - m.burstCenter) / m.burstWidth) ** 2));
  const lamMax = m.baseRate + m.burstRate;
  let t = 1.5;
  while (t < T - 4) {
    t += -Math.log(1 - rng()) / lamMax;
    if (rng() * lamMax > lam(t)) continue;
    for (let tries = 0; tries < 80; tries++) {
      const P = viewPoint(t, 1.08, 1.08);
      if (altOf(P) < 6) continue;
      const R = radiantWorld(cfg, t);
      const shower = rng() > m.sporadicFraction;
      let Tg, d;
      if (shower) {
        d = Math.acos(clamp(V.dot(P, R), -1, 1));
        if (d < 16 * DEG) continue;
        Tg = V.norm(V.sub(P, V.mul(R, V.dot(P, R))));
      } else {
        d = Math.PI / 2;
        const rr = V.norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        Tg = V.norm(V.sub(rr, V.mul(P, V.dot(rr, P))));
      }
      const L = clamp((30 + rng() * 38) * Math.sin(d), 3, 62) * DEG;
      const f = 0.2 + rng() * 0.6;
      const A = rotateAlong(P, Tg, -f * L), B = rotateAlong(P, Tg, (1 - f) * L);
      if (altOf(A) < 3 || altOf(B) < 3) continue;
      const u = rng();
      const bright = 0.28 + 2.3 * Math.pow(u, 3.4);
      const speed = 38 + rng() * 52;
      const dur = clamp((L / DEG) / speed, 0.36, 2.4);
      finish({
        kind: 'streak', t0: t, dur, lag: dur * 0.55 + 0.12, A, B, bright,
        width: 1.1 + 1.3 * Math.sqrt(bright), headR: 1.7 + 1.9 * Math.sqrt(bright),
        tint: tintPick(), seed: rng(), flicker: 0.05, flash: 0,
        trainDur: bright > 1.35 ? 1.2 + bright * 0.9 : 0, trainBright: 0.09 + 0.05 * bright,
      });
      break;
    }
  }

  // --- Fireballs ---
  for (const fb of cfg.fireballs) {
    for (let tries = 0; tries < 200; tries++) {
      const P = viewPoint(fb.t, 0.55, 0.5);
      if (altOf(P) < 22) continue;
      const R = radiantWorld(cfg, fb.t);
      const d = Math.acos(clamp(V.dot(P, R), -1, 1));
      if (d < 24 * DEG) continue;
      const Tg = V.norm(V.sub(P, V.mul(R, V.dot(P, R))));
      const L = fb.lengthDeg * DEG;
      const A = rotateAlong(P, Tg, -0.5 * L), B = rotateAlong(P, Tg, 0.5 * L);
      if (altOf(A) < 14 || altOf(B) < 8) continue;
      const big = !!fb.super;
      finish({
        kind: big ? 'super' : 'fireball', t0: fb.t, dur: fb.dur, lag: fb.dur * 0.5, A, B,
        bright: fb.bright, width: big ? 8.5 : 5.2, headR: big ? 19 : 12,
        tint: big ? [1.0, 0.72, 0.42] : [1.0, 0.82, 0.58], seed: rng(), flicker: 0.32,
        flash: fb.flash, flashTint: big ? [1.0, 0.82, 0.60] : [0.95, 0.85, 0.7],
        trainDur: big ? 16 : 8, trainBright: big ? 0.38 : 0.26, sparks: true, fragments: big ? [0.5, 0.72, 0.88, 0.97] : [0.6, 0.93],
      });
      break;
    }
  }

  // --- Earthgrazers: slow, long, low, orange ---
  for (const g of cfg.grazers || []) {
    for (let tries = 0; tries < 200; tries++) {
      const { az } = cameraAt(cfg, g.t);
      const P = dirFromAzAlt(az + (rng() * 2 - 1) * 30, 14 + rng() * 14);
      const sgn = rng() < 0.5 ? -1 : 1;
      const Tg = V.mul(V.norm(V.cross([0, 1, 0], P)), sgn);
      const L = g.lengthDeg * DEG;
      const A = rotateAlong(P, Tg, -0.5 * L), B = rotateAlong(P, Tg, 0.5 * L);
      if (altOf(A) < 6 || altOf(B) < 6) continue;
      finish({
        kind: 'grazer', t0: g.t, dur: g.dur, lag: g.dur * 0.38, A, B, bright: g.bright,
        width: 3.2, headR: 8, tint: [1.0, 0.66, 0.36], seed: rng(), flicker: 0.22, flash: 0.06,
        flashTint: [1.0, 0.7, 0.45], trainDur: 6, trainBright: 0.2, sparks: true, fragments: [0.7],
      });
      break;
    }
  }
  events.sort((a, b) => a.t0 - b.t0);

  // --- Satellites ---
  const sats = [];
  for (const s of cfg.satellites || []) {
    const { az } = cameraAt(cfg, s.t + s.dur / 2);
    const az0 = az + 90 + (rng() * 2 - 1) * 25;
    const A = dirFromAzAlt(az0, 12 + rng() * 8);
    const B = dirFromAzAlt(az0 + 180 + (rng() * 2 - 1) * 20, 12 + rng() * 8);
    sats.push({ t0: s.t, dur: s.dur, A, B, omega: Math.acos(clamp(V.dot(A, B), -1, 1)), seed: rng() });
  }
  return { events, sats };
}

// Spark / fragment particles for fireballs (deterministic)
export function buildSparks(cfg, events) {
  const rng = mulberry32(cfg.seed ^ 0xBADA55);
  const out = [];
  for (const e of events) {
    if (!e.sparks) continue;
    const n = Math.floor(e.dur * (e.kind === 'super' ? 70 : 42));
    for (let i = 0; i < n; i++) {
      out.push({ e, pB: 0.04 + 0.96 * Math.pow(rng(), 0.8), life: 0.9 + rng() * 1.6, ang: rng() * 6.283,
        speed: (0.004 + rng() * 0.02) * (e.kind === 'super' ? 1.4 : 1), size: 1.8 + rng() * 2.2, heat: 0.8 + rng() * 1.8, seed: rng() });
    }
    for (const fp of e.fragments || []) {
      const nb = e.kind === 'super' ? 46 : 26;
      for (let i = 0; i < nb; i++) {
        out.push({ e, pB: fp, life: 1.2 + rng() * 2.4, ang: rng() * 6.283,
          speed: (0.01 + rng() * 0.045), size: 2.2 + rng() * 2.8, heat: 1.2 + rng() * 2.6, seed: rng() });
      }
    }
  }
  return out;
}

// Light curve of a meteor's head (0..1 along its path)
export function headCurve(e, p) {
  if (e.kind === 'streak') return smooth(0, 0.12, p) * (0.7 + 0.3 * Math.sin(Math.PI * p));
  let lc = smooth(0, 0.22, p) * (0.5 + 0.5 * p);
  for (const fp of e.fragments || []) lc += 0.9 * Math.exp(-(((p - fp) / 0.018) ** 2));
  lc += 1.4 * Math.exp(-(((p - 0.985) / 0.025) ** 2));
  return lc;
}
