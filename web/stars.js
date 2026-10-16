import * as THREE from 'three';
import { eqVec, galToEq, DEG } from './shared.js';

// name, RA(deg), Dec(deg), magnitude, B-V   (real bright stars, J2000)
const CATALOG = [
  ['Sirius',101.287,-16.716,-1.46,0.0],['Canopus',95.988,-52.696,-0.74,0.15],['Arcturus',213.915,19.182,-0.05,1.23],
  ['Vega',279.234,38.784,0.03,0.0],['Capella',79.172,45.998,0.08,0.8],['Rigel',78.634,-8.202,0.13,-0.03],
  ['Procyon',114.825,5.225,0.34,0.42],['Betelgeuse',88.793,7.407,0.5,1.85],['Altair',297.696,8.868,0.77,0.22],
  ['Aldebaran',68.98,16.509,0.85,1.54],['Antares',247.352,-26.432,1.06,1.83],['Spica',201.298,-11.161,0.97,-0.23],
  ['Pollux',116.329,28.026,1.14,1.0],['Fomalhaut',344.413,-29.622,1.16,0.09],['Deneb',310.358,45.28,1.25,0.09],
  ['Regulus',152.093,11.967,1.35,-0.11],['Bellatrix',81.283,6.35,1.64,-0.22],['Alnilam',84.053,-1.202,1.69,-0.18],
  ['Alnitak',85.19,-1.943,1.77,-0.21],['Mintaka',83.002,-0.299,2.23,-0.18],['Saiph',86.939,-9.67,2.06,-0.17],
  ['Castor',113.65,31.888,1.58,0.03],['Elnath',81.573,28.608,1.65,-0.13],['Polaris',37.955,89.264,1.98,0.6],
  ['Dubhe',165.932,61.751,1.79,1.07],['Alpheratz',2.097,29.09,2.06,-0.11],['Mirfak',51.081,49.861,1.8,0.48],
  ['Hamal',31.793,23.463,2.0,1.15],['Schedar',10.127,56.537,2.24,1.17],['Alphard',141.897,-8.659,1.98,1.44],
  ['Rasalhague',263.734,12.56,2.08,0.16],['Shaula',263.402,-37.104,1.62,-0.22],['Sargas',264.33,-42.998,1.86,0.4],
  ['KausAustralis',276.043,-34.385,1.85,-0.03],['Nunki',283.816,-26.297,2.05,-0.2],['Eltanin',269.151,51.489,2.23,1.52],
  ['Enif',326.046,9.875,2.39,1.52],['Markab',346.19,15.205,2.49,-0.04],['Scheat',345.944,28.083,2.42,1.67],
  ['Algol',47.042,40.956,2.1,-0.05],['Alcyone',56.871,24.105,2.87,-0.09],['Menkalinan',89.882,44.947,1.9,0.03],
  ['Meissa',83.784,9.934,3.39,-0.16],['Tejat',93.719,22.514,2.88,1.64],['Mebsuta',100.983,25.131,3.06,1.4],
  ['Wezen',107.098,-26.393,1.83,0.67],['Adhara',104.656,-28.972,1.5,-0.21],['Mirzam',95.675,-17.956,1.98,-0.24],
  ['Diphda',10.897,-17.987,2.04,1.02],['Acrux',186.65,-63.099,0.77,-0.24],['Hadar',210.956,-60.373,0.61,-0.23],
  ['Mimosa',191.93,-59.689,1.25,-0.23],['RigilKent',219.9,-60.834,-0.01,0.71],['Achernar',24.429,-57.237,0.46,-0.16],
  ['Gacrux',187.791,-57.113,1.64,1.6],['Kochab',222.676,74.156,2.08,1.47],['Alioth',193.507,55.96,1.77,-0.02],
  ['Mizar',200.981,54.925,2.27,0.02],['Alkaid',206.885,49.313,1.86,-0.19],['Denebola',177.265,14.572,2.14,0.09],
  ['Algieba',154.993,19.842,2.28,1.15],['Zubenelgenubi',222.72,-16.042,2.75,0.15],['Sadr',305.557,40.257,2.23,0.67],
  ['Albireo',292.68,27.96,3.18,1.13],['Navi',14.177,60.717,2.47,-0.15],['Caph',2.295,59.15,2.27,0.34],
];

function bvToRGB(bv) {
  const stops = [[-0.3,[0.60,0.72,1.0]],[0.0,[0.78,0.86,1.0]],[0.3,[0.95,0.96,1.0]],[0.6,[1.0,0.95,0.82]],[0.9,[1.0,0.84,0.62]],[1.3,[1.0,0.70,0.46]],[1.8,[1.0,0.56,0.38]]];
  if (bv <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (bv <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (bv - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}
const randBV = (rng) => { const r = rng(); return r < 0.14 ? -0.15 + rng() * 0.3 : r < 0.42 ? 0.2 + rng() * 0.35 : r < 0.8 ? 0.5 + rng() * 0.45 : 0.9 + rng() * 0.8; };

export function buildStars(cfg, rng, uniforms) {
  const pos = [], mag = [], tint = [], phase = [];
  const push = (v, m, bv) => { pos.push(v[0], v[1], v[2]); mag.push(m); const c = bvToRGB(bv); tint.push(c[0], c[1], c[2]); phase.push(rng()); };

  for (const s of CATALOG) push(eqVec(s[1], s[2]), s[3], s[4]);
  // Pleiades cluster
  for (let i = 0; i < 9; i++) push(eqVec(56.75 + (rng() - 0.5) * 2.2, 24.1 + (rng() - 0.5) * 2.0), 3.4 + rng() * 2.4, -0.1);

  // Field stars: magnitude law N(m) ~ 10^(0.45 m), denser toward the galactic plane
  const N = cfg.quality.starCount, a = 1.8, b = 6.5;
  const ka = Math.pow(10, 0.45 * a), kb = Math.pow(10, 0.45 * b);
  for (let made = 0; made < N;) {
    const z = rng() * 2 - 1, ph = rng() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
    const bl = Math.asin(z);
    if (rng() * 2.3 > 0.3 + 2.0 * Math.exp(-((bl / 0.3) ** 2))) continue;
    push(galToEq([r * Math.cos(ph), r * Math.sin(ph), z]), Math.log10(rng() * (kb - ka) + ka) / 0.45, randBV(rng));
    made++;
  }
  // Unresolved Milky Way "dust" stars: faint, tightly packed along the plane
  const M = N * 3;
  for (let made = 0; made < M;) {
    const l = rng() * 2 * Math.PI;
    const g = (rng() + rng() + rng() + rng() - 2) * 0.12;
    if (rng() > 0.35 + 0.65 * Math.max(0, Math.cos(l))) continue;
    const cb = Math.cos(g);
    push(galToEq([cb * Math.cos(l), cb * Math.sin(l), Math.sin(g)]), 6.7 + rng() * 1.6, 0.4 + rng() * 0.6);
    made++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(new Float32Array(mag), 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(tint), 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phase), 1));
  return geo;
}
