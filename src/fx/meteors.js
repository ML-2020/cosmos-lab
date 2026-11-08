// Meteors.  Real: the major showers' radiants, peak dates, rates (ZHR) and speeds; shower meteors streak away from
// the radiant, sporadic ones come from anywhere; at 1x time the rate is the physical one.  `boost` multiplies the rate
// so a short look is not an empty sky.  Each streak is drawn at ~100 km altitude in the observer's own local frame.
import * as THREE from 'three';
import { logDepth, clamp } from '../util.js';
import { eqToVec, localFrame, lstDeg, dirToHoriz, D2R, R2D } from '../astro.js';

// name, month, day (peak, UTC), ZHR, half-width (days), radiant RA/Dec (deg, J2000), speed km/s
export const SHOWERS = [
  { id: 'QUA', zh: '象限仪座流星雨', mo: 1, d: 3.8, zhr: 80, w: 0.7, ra: 230.1, dec: 48.5, v: 41 },
  { id: 'LYR', zh: '天琴座流星雨', mo: 4, d: 22.5, zhr: 18, w: 1.6, ra: 271.4, dec: 33.6, v: 49 },
  { id: 'ETA', zh: '宝瓶座η流星雨', mo: 5, d: 6.0, zhr: 50, w: 3.5, ra: 338.0, dec: -1.0, v: 66 },
  { id: 'SDA', zh: '宝瓶座δ南流星雨', mo: 7, d: 30.0, zhr: 25, w: 8, ra: 340.0, dec: -16.4, v: 41 },
  { id: 'PER', zh: '英仙座流星雨', mo: 8, d: 12.7, zhr: 100, w: 4, ra: 48.0, dec: 58.0, v: 59 },
  { id: 'DRA', zh: '天龙座流星雨', mo: 10, d: 8.5, zhr: 10, w: 0.6, ra: 262.0, dec: 54.0, v: 20 },
  { id: 'ORI', zh: '猎户座流星雨', mo: 10, d: 21.5, zhr: 20, w: 5, ra: 95.0, dec: 15.8, v: 66 },
  { id: 'STA', zh: '金牛座南流星雨', mo: 11, d: 5.0, zhr: 5, w: 14, ra: 52.0, dec: 13.0, v: 27 },
  { id: 'LEO', zh: '狮子座流星雨', mo: 11, d: 17.7, zhr: 15, w: 1.2, ra: 152.3, dec: 22.2, v: 71 },
  { id: 'GEM', zh: '双子座流星雨', mo: 12, d: 14.0, zhr: 150, w: 2.6, ra: 112.3, dec: 32.5, v: 35 },
  { id: 'URS', zh: '小熊座流星雨', mo: 12, d: 22.5, zhr: 10, w: 1.3, ra: 217.0, dec: 75.8, v: 33 },
];
const SPORADIC_ZHR = 6;

// current activity (fraction of peak ZHR) of each shower on a date
export function activeShowers(jd) {
  const dt = new Date((jd - 2440587.5) * 86400000), y = dt.getUTCFullYear(), out = [];
  for (const s of SHOWERS) {
    let best = 1e9;
    for (const yy of [y - 1, y, y + 1]) best = Math.min(best, Math.abs((Date.UTC(yy, s.mo - 1, 1) + (s.d - 1) * 86400000 - dt.getTime()) / 86400000));
    const f = Math.pow(0.5, (best / s.w) ** 2);                          // Gaussian-like profile, half-width w days
    if (f * s.zhr >= 1) out.push({ ...s, zhrNow: f * s.zhr, f });
  }
  return out.sort((a, b) => b.zhrNow - a.zhrNow);
}

const N = 40;
const VERT = /* glsl */ `
attribute vec3 aP0, aP1; attribute vec2 aC; attribute float aA;
uniform vec2 uRes; uniform float uWidth;
varying float vA, vAlong;
void main(){
  mat4 M = projectionMatrix * modelViewMatrix;
  vec4 c0 = M * vec4(aP0, 1.0), c1 = M * vec4(aP1, 1.0);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(c0, c1, aC.x);
  c.xy += nrm * aC.y * uWidth * 2.0 / uRes * c.w;
  vA = (c0.w > 1e-4 && c1.w > 1e-4) ? aA : 0.0; vAlong = aC.x;
  gl_Position = c;
}`;
const FRAG = /* glsl */ `
varying float vA, vAlong;
void main(){
  float a = vA * pow(clamp(vAlong, 0.0, 1.0), 1.5);   // interpolation can leave [0,1] by a rounding error; pow() of a negative is NaN
  if (!(a >= 0.002)) discard;                          // (also rejects NaN)
  gl_FragColor = vec4(mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.97, 0.85), vAlong) * a * 6.0, 1.0);
}`;

export class Meteors {
  constructor(app, model) {
    this.app = app; this.m = model; this.slots = Array.from({ length: N }, () => ({ on: false }));
    const g = new THREE.BufferGeometry(), n4 = N * 4;
    this.aP0 = new Float32Array(n4 * 3); this.aP1 = new Float32Array(n4 * 3); this.aA = new Float32Array(n4);
    const aC = new Float32Array(n4 * 2), idx = [];
    for (let k = 0; k < N; k++) {
      [[0, -1], [0, 1], [1, -1], [1, 1]].forEach((c, i) => { aC[(k * 4 + i) * 2] = c[0]; aC[(k * 4 + i) * 2 + 1] = c[1]; });
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n4 * 3), 3));
    g.setAttribute('aP0', new THREE.BufferAttribute(this.aP0, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aP1', new THREE.BufferAttribute(this.aP1, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.aA, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aC', new THREE.BufferAttribute(aC, 2)); g.setIndex(idx);
    this.u = { uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.6 } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.u, ...logDepth(VERT, FRAG), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -14;
    this._fr = {}; this._tmp = new THREE.Vector3(); this._v = new THREE.Vector3(); this._acc = 0;
    this.shower = null; this.radiant = null;
  }

  // unit sky direction (east, up, north) -> point on the ~100 km shell, km in local ENU axes
  static shell(d, out, hKm = 100) { const k = hKm / Math.max(d[1], 0.09); return out.set(d[0] * k, d[1] * k, d[2] * k); }

  update(ctx, S, dtReal, A) {
    const jd = ctx.jd, fr = localFrame(S.lat, lstDeg(jd, S.lon), this._fr), eph = ctx.eph;
    const act = (this._act && Math.abs(jd - this._actJd) < 0.5) ? this._act : (this._actJd = jd, this._act = activeShowers(jd));
    // radiants in the local sky (east, up, north components)
    const rad = act.map((s) => { const v = eqToVec(s.ra, s.dec, 1, this._v.set(0, 0, 0)).applyMatrix4(eph.P); const h = dirToHoriz(v, fr); const a = h.az * D2R, e = h.alt * D2R; return { s, alt: h.alt, az: h.az, dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] }; });
    this.radiants = rad;
    const rateMul = Math.max(1, Math.abs(S.rate)) * S.meteorBoost;
    // spawn: Poisson in real time, physical rate x time acceleration x boost, capped
    const dark = ctx.cond.day < 0.4 && ctx.zoom > 0.8 && S.meteors && S.playing;
    if (dark) {
      let lam = SPORADIC_ZHR * 0.6 / 3600;                                   // sporadic: all-sky, roughly 60% of ZHR-equivalent
      for (const r of rad) lam += (r.s.zhrNow / 3600) * Math.max(0, r.dir[1]);
      lam = Math.min(lam * rateMul, 4);
      this._acc += lam * dtReal;
      while (this._acc >= 1) { this._acc -= 1; this.#spawn(ctx, rad); }
      if (this._acc > 0 && Math.random() < this._acc * 0.0) this._acc = 0;
    }
    // advance and write
    const now = ctx.time, u = this.mesh.geometry.attributes;
    for (let k = 0; k < N; k++) {
      const m = this.slots[k], o = k * 12;
      if (!m.on) { for (let i = 0; i < 4; i++) this.aA[k * 4 + i] = 0; continue; }
      const t = (now - m.t0) / m.dur;
      if (t >= 1.25) { m.on = false; for (let i = 0; i < 4; i++) this.aA[k * 4 + i] = 0; continue; }
      const th = clamp(t, 0, 1), tt = clamp(t - m.lag, 0, 1);
      const head = this._tmp.copy(m.a).lerp(m.b, th), tail = this._v.copy(m.a).lerp(m.b, tt);
      const e = A.east, up = A.up, n = A.north, kk = 1 / 6371;
      const w = (p, out, i) => { out[i] = (e.x * p.x + up.x * p.y + n.x * p.z) * kk; out[i + 1] = (e.y * p.x + up.y * p.y + n.y * p.z) * kk; out[i + 2] = (e.z * p.x + up.z * p.y + n.z * p.z) * kk; };
      for (let i = 0; i < 4; i++) { w(tail, this.aP0, (k * 4 + i) * 3); w(head, this.aP1, (k * 4 + i) * 3); }
      const fade = Math.sin(clamp(t, 0, 1) * Math.PI) ** 0.6 * (t > 1 ? Math.max(0, 1 - (t - 1) * 4) : 1);
      for (let i = 0; i < 4; i++) this.aA[k * 4 + i] = m.b0 * fade;
    }
    u.aP0.needsUpdate = u.aP1.needsUpdate = u.aA.needsUpdate = true;
    this.u.uRes.value.set(this.app.renderer.domElement.width, this.app.renderer.domElement.height);
    this.u.uWidth.value = 1.1 * this.app.renderer.domElement.height / 900;
    this.mesh.visible = S.meteors && ctx.zoom > 0.8;
    this.shower = act[0] || null;
  }

  #spawn(ctx, rad) {
    const slot = this.slots.find((s) => !s.on); if (!slot) return;
    // pick the origin of this meteor: a shower in proportion to its current rate, else sporadic
    let wSum = SPORADIC_ZHR * 0.6; for (const r of rad) wSum += r.s.zhrNow * Math.max(0, r.dir[1]);
    let pick = Math.random() * wSum, src = null;
    for (const r of rad) { const w = r.s.zhrNow * Math.max(0, r.dir[1]); if (pick < w) { src = r; break; } pick -= w; }
    let s, tdir, L;
    for (let tries = 0; tries < 30; tries++) {
      const az = Math.random() * Math.PI * 2, alt = (14 + Math.random() * 66) * D2R;
      s = [Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)];
      if (src) {
        const c = s[0] * src.dir[0] + s[1] * src.dir[1] + s[2] * src.dir[2], th = Math.acos(clamp(c, -1, 1));
        if (th < 0.3 || th > 2.2) continue;
        tdir = [s[0] - src.dir[0] * c, s[1] - src.dir[1] * c, s[2] - src.dir[2] * c];
        L = (6 + 24 * Math.random()) * Math.sin(th) * (src.s.v / 60) * D2R * 0.8;
      } else {
        const a = Math.random() * Math.PI * 2, r1 = [Math.cos(a), 0, -Math.sin(a)];
        tdir = [r1[0] - s[0] * (r1[0] * s[0] + r1[2] * s[2]), -s[1] * (r1[0] * s[0] + r1[2] * s[2]), r1[2] - s[2] * (r1[0] * s[0] + r1[2] * s[2])];
        L = (3 + 14 * Math.random()) * D2R;
      }
      const l = Math.hypot(...tdir); if (l < 1e-6) continue; tdir = tdir.map((x) => x / l);
      const e = [s[0] * Math.cos(L) + tdir[0] * Math.sin(L), s[1] * Math.cos(L) + tdir[1] * Math.sin(L), s[2] * Math.cos(L) + tdir[2] * Math.sin(L)];
      if (e[1] < 0.12) continue;                                     // it must end above the trees
      const fireball = Math.random() < 0.06;
      slot.on = true; slot.t0 = ctx.time; slot.dur = (fireball ? 1.4 : 0.35 + 0.5 * Math.random()) * (src ? 1 : 1.1); slot.lag = fireball ? 0.5 : 0.42;
      slot.a = Meteors.shell(s, new THREE.Vector3()); slot.b = Meteors.shell(e, new THREE.Vector3()); slot.b0 = fireball ? 2.6 : 0.55 + Math.random() * 0.9;
      return;
    }
  }
}
