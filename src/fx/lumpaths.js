// Where the Sun and the Moon go, drawn by each cosmology's own geometry.
//   LumPaths  first-person view: today's Sun and Moon paths across the sky (with hour marks), the Sun's path at the equinox and
//             at the two solstices, and - when the cosmology disagrees with the real sky by more than a degree - the real path as a
//             dashed ghost under it.  Every point comes from `app.lumAt()`, i.e. from the model's own prediction.
//   LumTrail  overview: a glowing trail behind the Sun and Moon (behind the Earth and Moon in the heliocentric model) as time plays,
//             in the model's own space - the Sun circling a disc, a sphere, a Ptolemaic machine, or standing still while the Earth moves.
import * as THREE from 'three';
import { horizToDir, dateFromJd, jdFromDate, gmstDeg, D2R } from '../astro.js';
import { zoned, fromZoned } from '../ui/dom.js';
import { smoothstep } from '../util.js';

const R = 0.9;                                  // radius (Earth radii) the paths are drawn at around the observer
const NS = 96;                                  // samples across the local day: every 15 minutes
const NA = 48;                                  // samples across a day for the seasonal arcs: every 30 minutes
const SEASONS = [['春秋分', 3, 20, 0xd99a12], ['夏至', 6, 21, 0xd9472a], ['冬至', 12, 21, 0x3f7bd8]];
const HIDE = -0.3;                              // below this altitude (deg) a path is not drawn: it would be under the ground

export const paramKey = (m) => { try { return JSON.stringify(m.params || {}); } catch (e) { return ''; } };

export class LumPaths {
  constructor(app, model) {
    this.app = app; this.m = model;
    this.key = ''; this.job = null; this.data = null;
    this.arcKey = ''; this.arcJob = null; this.arcs = null;
    this.labels = []; this.polys = []; this.dots = []; this.ghost = { sun: false, moon: false }; this.alpha = 0;
    this._tmp = {};
  }

  // spend a little time per frame on the samples (the ephemeris is not free), until the whole day is there
  _work(job, budget) {
    const n = job.jds.length;
    for (let c = 0; c < budget && job.i < n; c++, job.i++) job.each(job.i, this.app.lumAt(job.jds[job.i], this.m, this._tmp));
    return job.i >= n;
  }

  _startDay(z, tz, key) {
    const t0 = jdFromDate(new Date(fromZoned(z.y, z.mo, z.d, 0, 0, tz))), t1 = jdFromDate(new Date(fromZoned(z.y, z.mo, z.d + 1, 0, 0, tz)));
    const jds = Array.from({ length: NS + 1 }, (_, i) => t0 + (t1 - t0) * i / NS);
    const F = () => new Float32Array(NS + 1), d = { sA: F(), sZ: F(), mA: F(), mZ: F(), srA: F(), srZ: F(), mrA: F(), mrZ: F(), jds, sepS: 0, sepM: 0 };
    const sep = (a, b) => { const r = Math.PI / 180, A = a.alt * r, B = b.alt * r, dz = (a.az - b.az) * r; return Math.acos(Math.min(1, Math.max(-1, Math.sin(A) * Math.sin(B) + Math.cos(A) * Math.cos(B) * Math.cos(dz)))) / r; };
    this.job = { key, jds, i: 0, d, each: (i, L) => {
      d.sA[i] = L.mine.sun.alt; d.sZ[i] = L.mine.sun.az; d.mA[i] = L.mine.moon.alt; d.mZ[i] = L.mine.moon.az;
      d.srA[i] = L.real.sun.alt; d.srZ[i] = L.real.sun.az; d.mrA[i] = L.real.moon.alt; d.mrZ[i] = L.real.moon.az;
      if (L.real.sun.alt > 0) d.sepS = Math.max(d.sepS, sep(L.mine.sun, L.real.sun));
      if (L.real.moon.alt > 0) d.sepM = Math.max(d.sepM, sep(L.mine.moon, L.real.moon));
    } };
  }

  _startArcs(z, tz, key) {
    const jds = []; for (const s of SEASONS) { const t0 = jdFromDate(new Date(fromZoned(z.y, s[1], s[2], 0, 0, tz))); for (let i = 0; i <= NA; i++) jds.push(t0 + i / NA); }
    const a = SEASONS.map(() => ({ A: new Float32Array(NA + 1), Z: new Float32Array(NA + 1) }));
    this.arcJob = { key, jds, i: 0, a, each: (i, L) => { const s = Math.floor(i / (NA + 1)), j = i % (NA + 1); a[s].A[j] = L.mine.sun.alt; a[s].Z[j] = L.mine.sun.az; } };
  }

  update(ctx, S, A) {
    const on = S.paths && ctx.zoom > 0.80 && Math.abs(S.rate) <= 100000;          // a path for "today" means nothing at a day per second
    this.alpha = on ? smoothstep(0.80, 0.92, ctx.zoom) : 0;
    this.labels.length = 0; this.polys.length = 0; this.dots.length = 0;
    if (this.alpha < 0.01) return;
    const tz = this.app.tz || 'UTC', z = zoned(dateFromJd(ctx.jd).getTime(), tz), pk = paramKey(this.m);
    const key = `${this.m.id}|${S.lat.toFixed(2)}|${S.lon.toFixed(2)}|${z.y}-${z.mo}-${z.d}|${pk}`;
    if (key !== this.key && this.job?.key !== key) this._startDay(z, tz, key);
    if (this.job && this._work(this.job, 20)) { this.data = this.job.d; this.key = this.job.key; this.job = null; this.ghost = { sun: this.data.sepS > 1, moon: this.data.sepM > 1 }; }
    const arcKey = `${this.m.id}|${S.lat.toFixed(2)}|${S.lon.toFixed(2)}|${z.y}|${pk}`;
    if (S.arcs) {
      if (arcKey !== this.arcKey && this.arcJob?.key !== arcKey) this._startArcs(z, tz, arcKey);
      if (this.arcJob && this._work(this.arcJob, 24)) { this.arcs = this.arcJob.a; this.arcKey = this.arcJob.key; this.arcJob = null; }
    }
    const d = this.data; if (!d) return;
    // each polyline is a run of consecutive points above the horizon, in model coordinates (final, as seen: no further perspective)
    const pt = (az, alt) => horizToDir(az, alt, A, new THREE.Vector3()).multiplyScalar(R).add(A.pos);
    const add = (alts, azs, n, style) => {
      let cur = null;
      for (let i = 0; i <= n; i++) {
        if (alts[i] < HIDE) { cur = null; continue; }
        if (!cur) { cur = []; this.polys.push({ ...style, pts: cur }); }
        cur.push(pt(azs[i], alts[i]));
      }
    };
    if (S.arcs && this.arcs) SEASONS.forEach((s, i) => {
      add(this.arcs[i].A, this.arcs[i].Z, NA, { who: 'arc', col: s[3], w: 1.6, a: 0.8 });
      let k = 0; const aa = this.arcs[i].A; for (let j = 1; j <= NA; j++) if (aa[j] > aa[k]) k = j;
      if (aa[k] > 2) this.labels.push({ pos: pt(this.arcs[i].Z[k], aa[k] + 1.8), text: s[0], c: '#' + s[3].toString(16).padStart(6, '0') });
    });
    if (this.ghost.sun) add(d.srA, d.srZ, NS, { who: 'ghost', w: 1.5, dash: true, a: 0.9 });
    if (this.ghost.moon) add(d.mrA, d.mrZ, NS, { who: 'ghost', w: 1.5, dash: true, a: 0.8 });
    add(d.mA, d.mZ, NS, { who: 'moon', w: 2.4, a: 1 });
    add(d.sA, d.sZ, NS, { who: 'sun', w: 2.8, a: 1 });
    // an hour mark and a label every two hours on the part of each path above the horizon
    for (const [who, alts, azs] of [['sun', d.sA, d.sZ], ['moon', d.mA, d.mZ]]) {
      for (let i = 0; i <= NS; i += 8) {
        if (alts[i] < 1.5) continue;
        const p = pt(azs[i], alts[i]), h = zoned(dateFromJd(d.jds[i]).getTime() + 1000, tz).h;
        this.dots.push({ pos: p, who });
        this.labels.push({ pos: p.clone(), text: `${h}时`, c: who === 'sun' ? '#ffe3ac' : '#dbe8ff' });
      }
    }
  }
}

// ----------------------------------------------------------------------------------------------- overview trails
const NT = 720, Y = new THREE.Vector3(0, 1, 0);
export class LumTrail {
  constructor(app, model) {
    this.app = app; this.m = model;
    this.group = new THREE.Group(); this.group.name = 'lum-trail'; this.group.visible = false;
    const helio = model.id === 'helio';
    // [property of the model holding the body's position, colour, shortest history in days]
    this.items = (helio ? [['earthPos', [0.35, 0.94, 0.85], 60], ['moonPos', [0.8, 0.88, 1], 60]] : [['sunPos', [1, 0.8, 0.42], 1.05], ['moonPos', [0.8, 0.88, 1], 1.05]])
      .map(([prop, rgb, days]) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NT + 2) * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((NT + 2) * 3), 3));
        g.setDrawRange(0, 0);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        line.frustumCulled = false; line.renderOrder = 4; this.group.add(line);
        return { prop, rgb, days, line, t: [], p: [], mode: '' };
      });
  }

  // The trail is recorded in the Earth-fixed frame while time runs slowly (the Sun circles the Earth once a day, so the trail is a ring),
  // and in the non-rotating frame once it runs faster than a day and a half per second (at which a sample per frame would be several
  // turns apart and the "ring" would turn into chords).  In the heliocentric model everything is already non-rotating.
  update(ctx, S) {
    const k = S.lumTrail ? 1 - smoothstep(0.34, 0.60, ctx.zoom) : 0;
    this.group.visible = k > 0.01;
    const jd = ctx.jd, gk = Math.round(ctx.g * 50), rate = Math.abs(S.rate), helio = this.m.id === 'helio';
    const inertial = !helio && rate > 150000, mode = gk + (inertial ? 'i' : 'e'), gm = gmstDeg(jd) * D2R;
    for (const b of this.items) {
      const cur = this.m[b.prop]; if (!cur) continue;
      const head = (b.head ??= new THREE.Vector3()).copy(cur); if (inertial) head.applyAxisAngle(Y, gm);
      const win = Math.max(b.days, rate * 3 / 86400), step = inertial || helio ? win / (NT - 1) : Math.min(win / (NT - 1), 1 / 48);
      if (b.mode !== mode) { b.t.length = 0; b.p.length = 0; b.mode = mode; }           // the model changes scale as the camera moves (and the frame as the speed does): old points would be in the wrong place
      if (b.t.length && Math.abs(jd - b.t[b.t.length - 1]) > win) { b.t.length = 0; b.p.length = 0; }    // time jumped
      if (!b.t.length || Math.abs(jd - b.t[b.t.length - 1]) >= step) { b.t.push(jd); b.p.push(head.clone()); }
      while (b.t.length && Math.abs(jd - b.t[0]) > win) { b.t.shift(); b.p.shift(); }
      if (!this.group.visible) continue;
      const pos = b.line.geometry.attributes.position.array, col = b.line.geometry.attributes.color.array;
      const n = Math.min(b.t.length, NT);
      for (let i = 0; i <= n; i++) {
        const p = i < n ? b.p[b.p.length - n + i] : head, age = i < n ? Math.min(1, Math.abs(jd - b.t[b.t.length - n + i]) / win) : 0, w = Math.pow(1 - age, 1.3) * 1.5 * k;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; col[i * 3] = b.rgb[0] * w; col[i * 3 + 1] = b.rgb[1] * w; col[i * 3 + 2] = b.rgb[2] * w;
      }
      b.line.geometry.setDrawRange(0, n + 1); b.line.geometry.attributes.position.needsUpdate = true; b.line.geometry.attributes.color.needsUpdate = true;
    }
  }
}
