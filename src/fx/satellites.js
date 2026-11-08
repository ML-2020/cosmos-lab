// Satellites.  Real: orbital mechanics (period from altitude, J2 node drift), Earth's cylindrical shadow (a satellite is
// only seen while the Sun still shines on it), distance and Sun-phase brightness, apparent motion across the sky.
// ILLUSTRATIVE: the orbits are generic ones with the real altitude/inclination of each family, not live tracking
// (that needs current orbital elements from the internet), so a pass at a given hour here is not a real pass.
import * as THREE from 'three';
import { starMaterial } from '../sky.js';
import { localFrame, lstDeg, D2R, R2D } from '../astro.js';

const MU = 398600.4418, RE = 6378.137, J2 = 1.08263e-3;
const FAMILIES = [
  { id: 'iss', zh: '国际空间站', alt: 420, inc: 51.64, raan: 120, u0: 40, m0: -1.3, label: true, rgb: [1, 0.97, 0.9] },
  { id: 'css', zh: '天宫空间站', alt: 390, inc: 41.47, raan: 262, u0: 210, m0: -0.8, label: true, rgb: [1, 0.97, 0.9] },
  ...Array.from({ length: 18 }, (_, k) => ({ id: 'train' + k, zh: '星链列车', alt: 350, inc: 53.05, raan: 48, u0: 95 + k * 0.5, m0: 5.0, rgb: [0.95, 0.97, 1] })),
  ...[0, 1, 2, 3].map((k) => ({ id: 'ss' + k, zh: '太阳同步轨道卫星', alt: 700, inc: 98.2, raan: 10 + 95 * k, u0: 20 + 83 * k, m0: 4.5, rgb: [1, 0.96, 0.88] })),
  ...Array.from({ length: 24 }, (_, k) => ({ id: 'sl' + k, zh: '低轨星座', alt: 550, inc: 53.0, raan: 90 * (k % 4) + 7, u0: 60 * Math.floor(k / 4) + 11 * (k % 4), m0: 5.9, rgb: [0.95, 0.97, 1] })),
];
for (const f of FAMILIES) {
  const a = RE + f.alt; f.a = a; f.n = Math.sqrt(MU / a ** 3);                             // rad/s
  f.dRaan = -1.5 * J2 * (RE / a) ** 2 * f.n * Math.cos(f.inc * D2R);                      // rad/s, nodal regression
}
const N = FAMILIES.length, JD0 = 2461000.5;                                                  // arbitrary epoch of the illustrative elements

export class Satellites {
  constructor(model) {
    this.m = model;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.mag = new Float32Array(N).fill(99); this.col = new Float32Array(N * 3); this.seed = new Float32Array(N);
    FAMILIES.forEach((f, i) => { this.col.set(f.rgb, i * 3); this.seed[i] = (i * 0.618) % 1; });
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMag', new THREE.BufferAttribute(this.mag, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.points = new THREE.Points(g, starMaterial(model.sky.u)); this.points.frustumCulled = false; this.points.renderOrder = -15;
    this._fr = {}; this._r = new THREE.Vector3(); this._d = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.visible = [];                                  // [{zh, alt, az, mag, off: Vector3 (local model axes)}]
  }

  update(ctx, S, A) {
    const on = S.sats && ctx.zoom > 0.8;
    this.points.visible = on; if (!on) return;
    const jd = ctx.jd, fr = localFrame(S.lat, lstDeg(jd, S.lon), this._fr), sun = this._s.copy(ctx.eph.sun).normalize();
    const dtS = (jd - JD0) * 86400;
    this.visible.length = 0;
    for (let i = 0; i < N; i++) {
      const f = FAMILIES[i], u = f.u0 * D2R + f.n * dtS, W = f.raan * D2R + f.dRaan * dtS, ci = Math.cos(f.inc * D2R), si = Math.sin(f.inc * D2R);
      const r = f.a / 6371, cu = Math.cos(u), su = Math.sin(u), cW = Math.cos(W), sW = Math.sin(W);
      // inertial position (equator of date), then to scene axes (y = pole)
      const x = r * (cW * cu - sW * su * ci), y = r * (sW * cu + cW * su * ci), z = r * su * si;
      this._r.set(x, z, -y);
      const d = this._d.copy(this._r).sub(fr.up);                                   // topocentric, Earth radii
      const range = d.length(), e = d.dot(fr.east), n = d.dot(fr.north), up = d.dot(fr.up);
      this.pos[i * 3] = (A.east.x * e + A.north.x * n + A.up.x * up); this.pos[i * 3 + 1] = (A.east.y * e + A.north.y * n + A.up.y * up); this.pos[i * 3 + 2] = (A.east.z * e + A.north.z * n + A.up.z * up);
      const along = this._r.dot(sun), lit = !(along < 0 && this._r.lengthSq() - along * along < 1);
      const sinEl = up / range;
      let m = 99;
      if (lit && sinEl > -0.02) {
        const cosPhi = clamp01(-d.dot(sun) / range, -1, 1), phi = Math.acos(cosPhi);
        const phase = (Math.sin(phi) + (Math.PI - phi) * Math.cos(phi)) / Math.PI;      // diffuse sphere
        m = f.m0 - 2.5 * Math.log10(Math.max(phase, 1e-3)) + 5 * Math.log10(range * 6371 / 1000);
      }
      if (!Number.isFinite(m + this.pos[i * 3] + this.pos[i * 3 + 1] + this.pos[i * 3 + 2])) { m = 99; this.pos[i * 3] = this.pos[i * 3 + 1] = this.pos[i * 3 + 2] = 0; }
      this.mag[i] = m;
      if (f.label && m < 6 && sinEl > 0.05) this.visible.push({ zh: f.zh, alt: Math.asin(sinEl) * R2D, mag: m, i });
    }
    const g = this.points.geometry.attributes; g.position.needsUpdate = g.aMag.needsUpdate = true;
  }

  // positions for labels, in the local-group frame (offset from the anchor)
  labelPos(i, out) { return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }
}
const clamp01 = (x, a, b) => Math.max(a, Math.min(b, x));
