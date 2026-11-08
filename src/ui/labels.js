// HTML labels laid over the canvas: model parts in the palm view, compass + names under the open sky.
// Positions come from the same geometry the shaders use (model.perceive() mirrors any shader-side warp).
import * as THREE from 'three';
import { PLANETS } from '../astro.js';
import { clamp } from './dom.js';
import { GUIDE_INDEX } from '../guide.js';

const PL = Object.fromEntries(PLANETS.map((p) => [p.id, p]));
const KIND_RANK = { planet: 0, cardinal: 0, guide: 0, gstar: 1, model: 1, star: 2, dso: 3, cons: 4, cn: 4 };

export class Labels {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.live = new Map(); this.free = []; this.cache = new Map();
    this._v = new THREE.Vector3(); this._o = new THREE.Vector3(); this._d = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.cand = [];
    // the Sun/Moon paths are drawn here, in 2D: a one-pixel HDR line is lost against a bright sky and loses its colour in the tone map
    this.cv = document.createElement('canvas'); this.cv.className = 'pathcv'; this.cx = this.cv.getContext('2d'); root.prepend(this.cv);
  }

  _scr(p, W, H) {
    const cam = this.app.camera, v = this._v2 ??= new THREE.Vector3(), d = this._d2 ??= new THREE.Vector3();
    v.copy(p).sub(this.app.shift);
    if (d.copy(v).applyMatrix4(cam.matrixWorldInverse).z > -1e-9) return null;
    d.copy(v).project(cam);
    const x = (d.x * 0.5 + 0.5) * W, y = (0.5 - d.y * 0.5) * H;
    return Math.abs(x) < 1e5 && Math.abs(y) < 1e5 ? [x, y] : null;
  }

  _overlay(m) {
    const cv = this.cv, cx = this.cx, W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    const P = m.fx?.paths; if (!P || P.alpha < 0.01 || !P.polys.length) return;
    const day = this.app.cond.day > 0.45;
    const ink = { sun: day ? '#ee7d0a' : '#ffd27a', moon: day ? '#2f64e8' : '#cfe3ff', ghost: day ? '#1b2a44' : '#ffffff' };
    const halo = day ? 'rgba(255,255,255,.65)' : 'rgba(0,0,0,.5)';
    cx.lineCap = cx.lineJoin = 'round';
    for (const poly of P.polys) {
      const col = poly.who === 'arc' ? '#' + poly.col.toString(16).padStart(6, '0') : ink[poly.who];
      for (const pass of poly.dash ? [1] : [0, 1]) {
        cx.setLineDash(poly.dash ? [7, 6] : []); cx.strokeStyle = pass ? col : halo; cx.lineWidth = pass ? poly.w : poly.w + 3; cx.globalAlpha = P.alpha * poly.a * (pass ? 1 : 0.8);
        cx.beginPath(); let pen = false;
        for (const q of poly.pts) { const s = this._scr(q, W, H); if (!s) { pen = false; continue; } if (pen) cx.lineTo(s[0], s[1]); else { cx.moveTo(s[0], s[1]); pen = true; } }
        cx.stroke();
      }
    }
    cx.setLineDash([]);
    for (const d of P.dots) {
      const s = this._scr(d.pos, W, H); if (!s) continue;
      cx.globalAlpha = P.alpha; cx.fillStyle = halo; cx.beginPath(); cx.arc(s[0], s[1], 6.5, 0, 7); cx.fill();
      cx.fillStyle = ink[d.who]; cx.beginPath(); cx.arc(s[0], s[1], 4.2, 0, 7); cx.fill();
    }
    cx.globalAlpha = 1;
  }

  _anchors(m) {
    let a = this.cache.get(m.id);
    if (!a && m.sky) { a = m.sky.labelAnchors(); this.cache.set(m.id, a); }
    return a || [];
  }

  frame(ctx) {
    const app = this.app, S = app.S, m = app.model, cam = app.camera;
    const W = innerWidth, H = innerHeight;
    const out = this.cand; out.length = 0;
    this._overlay(m);
    if (!S.labels || !m.built) { this._draw([], W, H); return; }
    const z = S.zoom, A = m.anchor, rp = (v) => this._o.copy(v).sub(app.shift);
    const obs = this._p.copy(A.pos).sub(app.shift);
    const sunAlt = app.cond.sunAlt, dark = sunAlt < -4;

    const project = (rv, extra) => {
      // rv: render-space position (mutated)
      const vz = this._d.copy(rv).applyMatrix4(cam.matrixWorldInverse).z;
      if (vz > -1e-9) return;
      const ndc = this._d.copy(rv).project(cam);
      if (ndc.x < -1.04 || ndc.x > 1.04 || ndc.y < -1.06 || ndc.y > 1.06) return;
      out.push({ ...extra, x: (ndc.x * 0.5 + 0.5) * W, y: (0.5 - ndc.y * 0.5) * H });
    };

    // palm view: parts of the model
    if (z < 0.62 && m.labelItems) {
      const k = 1 - clamp((z - 0.42) / 0.2, 0, 1);
      for (const it of m.labelItems()) {
        if (it.kind === 'cardinal' && (z > 0.5 || (app.ctx?.D ?? 99) > 9)) continue;
        project(rp(it.pos), { kind: it.kind, text: it.text, c: it.hue, a: k, pri: 0 });
      }
      if (m.fx) for (const it of m.fx.labelItems()) project(rp(it.pos), { kind: it.kind, text: it.text, a: k, pri: it.kind.includes('sub') ? 4 : 0 });
    }

    // standing under the sky
    if (z > 0.72) {
      const k = clamp((z - 0.72) / 0.18, 0, 1);
      // compass on the horizon
      const R = 1e5;
      const dirS = A.north.clone().negate(), dirW = A.east.clone().negate();     // (project() reuses this._d, so these must be their own vectors)
      for (const [t, dir] of [['北', A.north], ['东', A.east], ['南', dirS], ['西', dirW]]) {
        const v = this._v.copy(obs).addScaledVector(dir, R).addScaledVector(A.up, R * 0.012);      // direction markers sit on the horizon; no perspective warp
        project(v, { kind: 'cardinal', text: t, a: k, pri: 0 });
      }
      // the compass needle: where it really points here (declination), and where this cosmology's own geometry says the pole is
      const cp = m.fx?.compass;
      if (S.mag && cp) {
        const put = (az, text, cls) => { const r = az * Math.PI / 180, v = this._v.copy(obs).addScaledVector(A.north, Math.cos(r) * R).addScaledVector(A.east, Math.sin(r) * R).addScaledVector(A.up, R * 0.012); project(v, { kind: 'compass ' + cls, text, a: k, pri: 0 }); };
        const dec = cp.decl;
        put((dec + 360) % 360, `罗盘磁北 · ${dec < 0 ? '偏西' : '偏东'} ${Math.abs(dec).toFixed(1)}°`, 'real');
        const dd = ((cp.modelAz - dec + 540) % 360) - 180;
        if (Math.abs(dd) > 4 && Math.abs(S.lat) < 88) put(cp.modelAz, '本假说中到磁北极的方向', 'model');
      }
      const fov = cam.fov, magLim = fov > 80 ? 1.3 : fov > 50 ? 1.9 : fov > 25 ? 2.7 : 3.6;
      const under = (v) => { const dx = v.x - obs.x, dy = v.y - obs.y, dz = v.z - obs.z, L = Math.hypot(dx, dy, dz) || 1; return (dx * A.up.x + dy * A.up.y + dz * A.up.z) / L < 0.005 && app.cond.atmo > 0.3; };
      const plan = (pos, text, c, raw) => { const v = this._v.copy(pos).sub(app.shift); if (raw && m.perceive) m.perceive(v, obs); if (under(v)) return; project(v, { kind: 'planet', text, c, a: k, pri: 0 }); };
      if (m.sunPos) { plan(m.sunApp || m.sunPos, '太阳', '#ffd27a', false); plan(m.moonApp || m.moonPos, '月亮', '#dfe8ff', false); }
      for (const p of m.planetList || []) plan(p.pos, PL[p.id].zh, PL[p.id].color, true);
      if (m.fx) for (const it of m.fx.skyLabels()) plan(it.pos, it.text, it.c, false);
      const anchors = this._anchors(m);
      if (anchors.length && m.sky) {
        const mw = m.sky.j2000.matrixWorld, dayHide = app.cond.day > 0.55;
        for (const a of anchors) {
          if (dayHide && a.kind !== 'cons' && a.kind !== 'cn') continue;
          if (a.kind === 'guide' || a.kind === 'gstar') { if (!S.guide) continue; }
          else if (a.kind === 'star') { if (a.mag > magLim || (S.guide && GUIDE_INDEX.has(a.idx))) continue; }
          else if (a.kind === 'cons') { if (S.lines !== 'west' || fov > 120) continue; }
          else if (a.kind === 'cn') { if (S.lines !== 'cn' || fov > 120) continue; }
          else if (a.kind === 'dso') { if (!S.dso || a.mag > (fov > 45 ? 5.2 : 8)) continue; }
          const v = this._v.copy(a.pos).applyMatrix4(mw);
          if (m.perceive) m.perceive(v, obs);
          if (under(v)) continue;                                  // below the ground
          project(v, { kind: a.kind, text: a.text, a: k * (a.kind === 'cons' || a.kind === 'cn' ? 0.9 : 1), pri: (KIND_RANK[a.kind] ?? 5) * 20 + (a.mag > 90 ? 6 : a.mag), rank: a.rank });
        }
      }
    }
    this._draw(out, W, H);
  }

  // A label keeps the same element for as long as it is on screen (keyed by kind + text), so while time plays an element is
  // never re-purposed from one label to another from frame to frame (that churned classes, text and compositor layers).
  _node(key) {
    let n = this.live.get(key);
    if (!n) {
      n = this.free.pop();
      if (!n) { n = document.createElement('div'); n.className = 'lb'; this.root.append(n); }
      n._k = ''; n._t = ''; n._c = undefined; n.style.opacity = '0';
      this.live.set(key, n);
    }
    return n;
  }

  _draw(list, W, H) {
    list.sort((a, b) => a.pri - b.pri);
    const taken = [], max = 70, seen = new Set();
    let used = 0;
    for (const L of list) {
      if (used >= max) break;
      const w = Math.max(28, L.text.length * 13), hgt = 20;
      let hit = false;
      if (L.kind !== 'cardinal' && !L.kind.startsWith('compass')) for (const t of taken) if (Math.abs(t.x - L.x) < (t.w + w) * 0.5 + 6 && Math.abs(t.y - L.y) < hgt) { hit = true; break; }
      if (hit) continue;
      taken.push({ x: L.x, y: L.y, w });
      used++;
      let key = L.kind + '|' + L.text; for (let d = 1; seen.has(key); d++) key = L.kind + '|' + L.text + '#' + d;
      seen.add(key);
      const n = this._node(key);
      if (n._k !== L.kind) { n.className = 'lb ' + L.kind; n._k = L.kind; }
      if (n._t !== L.text) { n.textContent = L.text; n._t = L.text; }
      if (L.c !== n._c) { n._c = L.c; if (L.c) n.style.setProperty('--c', typeof L.c === 'number' ? '#' + L.c.toString(16).padStart(6, '0') : L.c); else n.style.removeProperty('--c'); }
      const ctr = L.kind === 'cardinal' || L.kind === 'guide' || L.kind.startsWith('compass');
      const ox = ctr ? 0 : L.kind === 'cons' || L.kind === 'cn' ? -w * 0.42 : 12, oy = ctr ? (L.kind === 'compass model' ? 30 : 0) : -9;
      n.style.transform = `translate(${(L.x + ox).toFixed(1)}px, ${(L.y + oy).toFixed(1)}px)` + (L.kind === 'guide' || L.kind.startsWith('compass') ? ' translate(-50%, -50%)' : '');
      n.style.opacity = String(clamp(L.a ?? 1, 0, 1));
      n.style.display = '';
    }
    for (const [key, n] of this.live) if (!seen.has(key)) { n.style.display = 'none'; this.live.delete(key); this.free.push(n); }
  }
}
