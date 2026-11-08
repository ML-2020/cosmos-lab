// The App: renderer, shared state, time, observing conditions, the scale journey camera, input.
//
// Rendering uses a floating origin: the camera sits at (0,0,0) in render space and the whole `world`
// group is translated by -shift, where `shift` is the camera position in model coordinates (doubles).
// Anything that bypasses the scene graph (billboard centres, shader uniforms holding positions) must go
// through ctx.rp(v) = v - shift.
import * as THREE from 'three';
import { Post } from './post.js';
import { SkyDome, skyUniforms } from './atmosphere.js';
import { Ephemeris, jdFromDate, dateFromJd, D2R, R2D, gmstDeg, localFrame, dirToHoriz, lstDeg, polarisOfDate, eqToVec, PLANETS } from './astro.js';
import { makeDistanceCurve, journeyPose, EYE } from './journey.js';
import { clamp, smoothstep, lerp } from './util.js';
import { MODEL_CLASSES } from './models/index.js';
import { Phenomena } from './fx/index.js';
import { Cosmology } from './models/base.js';

// naked-eye limiting magnitude and sky glow by Bortle class 1..9
const BORTLE_LIM = [7.8, 7.4, 7.0, 6.5, 6.0, 5.5, 5.0, 4.4, 3.8];
const BORTLE_LP = [0.0, 0.04, 0.10, 0.20, 0.36, 0.55, 0.75, 0.90, 1.0];

// Extinction in V (magnitudes per airmass) for an observer `h` metres above sea level: ozone (above everything),
// Rayleigh (scale height ~8.4 km) and aerosols (~1.8 km).  Sea level = 0.24, Mauna Kea ~0.09.
export const extinctionK = (h) => 0.016 + 0.094 * Math.exp(-h / 8400) + 0.13 * Math.exp(-h / 1800);
// How far the horizon sits below the horizontal for an eye `h` metres above level ground (degrees, with typical refraction).
export const horizonDip = (h) => (1.76 / 60) * Math.sqrt(Math.max(h, 0));

export const DEFAULTS = {
  model: 'globe',
  lat: 31.2304, lon: 121.4737,              // Shanghai
  site: 4, height: 0,                       // metres: the place above sea level, and the observer above the ground
  jd: jdFromDate(new Date()), rate: 1, playing: true,
  zoom: 0.0, zoomTarget: 0.0,
  yaw: 0.55, pitch: 0.38,                   // overview orbit
  az: 0, alt: 35, fov: 75,                  // first person
  bortle: 3, mw: 1, limOffset: 0, gain: 0, exposure: 1.1, bloom: 0.42, vignette: 0.32, grain: 0.35,
  lines: 'none',                            // 'none' | 'west' | 'cn'
  grid: false, ecliptic: false, equator: false, labels: true, dso: true, guide: true,
  trails: 0,                                // star-trail sweep (degrees of sky rotation), + into the past
  ridges: 0.6, autorotate: true,
  paths: true, arcs: false, lumTrail: true,                       // the Sun and Moon paths in the sky / the equinox and solstice arcs / their trails in the overview
  aurora: true, kp: 3, meteors: true, meteorBoost: 8, sats: true, mag: true,   // sky phenomena and the magnetic-pole layer
};

export class App {
  constructor(canvas, labelsEl, init = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.post = new Post(this.renderer);
    this.scene = new THREE.Scene();
    this.world = new THREE.Group(); this.world.name = 'world';
    this.camera = new THREE.PerspectiveCamera(60, 1, 1e-9, 1e7);
    this.skyU = skyUniforms();
    this.dome = new SkyDome(this.skyU);
    this.scene.add(this.dome.mesh, this.world);
    this.eph = new Ephemeris();
    this.ephB = new Ephemeris();                                 // a second clock, for looking at other moments without disturbing the frame
    this.S = { ...DEFAULTS, ...init };
    this.eyeM = this.S.height + 1.7;                 // eye height above the ground right now (it glides to S.height + 1.7)
    this.cond = { sunAlt: -30, moonAlt: -30, moonHalo: 0, moonI: 0, day: 0, atmo: 0 };
    this.shift = new THREE.Vector3(); this._zero = new THREE.Vector3();
    this.pose = {};
    this.listeners = new Set();
    this.labelsEl = labelsEl;
    this.time = 0; this._last = performance.now(); this._idle = 0;
    this._pool = Array.from({ length: 12 }, () => new THREE.Vector3()); this._pi = 0;

    this.models = {};
    for (const C of MODEL_CLASSES) { const m = new C(this); this.models[m.id] = m; }
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setModel(this.S.model, true);
    this.#bindInput();
  }

  // ------------------------------------------------------------------ model / state
  get model() { return this.models[this.S.model]; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'state') { for (const f of this.listeners) f(kind, this.S); }

  setModel(id, silent = false) {
    const m = this.models[id]; if (!m) return;
    for (const k in this.models) {
      const o = this.models[k];
      if (k !== id) { o.setActive(false); }
    }
    if (!m.built) { m.build(); this.world.add(m.group); m.fx = new Phenomena(this, m); }
    m.setActive(true);
    this.S.model = id;
    this.rebuildCurve();
    if (m.overviewDefault && !silent) { this.S.yaw = m.overviewDefault.yaw; this.S.pitch = m.overviewDefault.pitch; }
    if (silent && m.overviewDefault) { this.S.yaw = m.overviewDefault.yaw; this.S.pitch = m.overviewDefault.pitch; }
    this.curveModel = id;
    if (!silent) this.emit('model');
  }

  // The journey's distance curve ends at the observer's eye: 1.7 m above the ground, or higher when lifted.
  rebuildCurve() {
    const m = this.model, n = m.journey.knots.length, ks = m.journey.knots.map((k) => [k[0], k[1]]);
    ks[n - 1][1] = this.eyeM / 6.371e6;
    for (let i = n - 2; i >= 0; i--) ks[i][1] = Math.max(ks[i][1], ks[i + 1][1] * 1.8);
    this.curve = makeDistanceCurve(ks);
  }

  // Patch the state.  Accepts `date` (ISO string) and `zoom` (applied instantly) conveniences; `snap` jumps the height at once.
  set(patch = {}) {
    const p = { ...patch };
    if (p.snap) { this.eyeM = (p.height ?? this.S.height) + 1.7; this.rebuildCurve(); }
    delete p.snap;
    if (p.date !== undefined) { p.jd = jdFromDate(new Date(p.date)); delete p.date; }
    if (p.zoom !== undefined && p.zoomTarget === undefined) p.zoomTarget = p.zoom;
    const model = p.model; delete p.model;
    Object.assign(this.S, p);
    if (model && model !== this.S.model) this.setModel(model);
    this.emit('state');
  }

  journeyTo(z, seconds = 3.2) {
    this._journey = { from: this.S.zoom, to: z, t0: this.time, dur: seconds };
  }

  // ----------------------------------------------------------------------- sizing
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------------- conditions
  // Called by the active model after it has set skyU.uSunDir / uMoonDir / uUp.
  applyConditions(u, bodies) {
    const S = this.S, su = this.skyU, e = this.eph;
    const sunSin = clamp(su.uSunDir.value.dot(su.uUp.value), -1, 1);
    const sunAlt = Math.asin(sunSin) * R2D;
    const moonSin = clamp(su.uMoonDir.value.dot(su.uUp.value), -1, 1);
    const atmo = smoothstep(0.76, 0.95, S.zoom);
    const night = 1 - smoothstep(-16, -4, sunAlt);
    const bi = clamp(Math.round(S.bortle), 1, 9) - 1;
    const lp = BORTLE_LP[bi];
    const moonFlux = clamp(Math.pow(10, -0.4 * (e.moonMag + 12.7)), 0, 1);
    const moonUp = smoothstep(-0.04, 0.16, moonSin);
    const moonI = moonFlux * moonUp;
    const day = smoothstep(-18, -1, sunAlt);

    su.uAtmo.value = atmo; su.uLP.value = lp * atmo; su.uMoonI.value = moonFlux;
    u.uAtmo.value = atmo; u.uDay.value = day * atmo;
    u.uObs.value.copy(this.rp(this.model.anchor.pos)); u.uUp.value.copy(su.uUp.value);
    const kV = extinctionK(S.site + this.eyeM);                 // thinner air above a higher eye: stars dim less near the horizon and the limit improves
    u.uK.value = kV;
    const lim = BORTLE_LIM[bi] + S.limOffset + (0.24 - kV) - 2.4 * moonI * night * atmo;
    const mid = smoothstep(0.18, 0.70, S.zoom);             // 0 = model in the palm, 1 = close in
    u.uMagLimit.value = lerp(lerp(6.2, 7.4, mid), lim, atmo);   // the palm view shows the bright stars only
    u.uInt.value = S.mw * (1 - 0.82 * lp * atmo) * (1 - 0.65 * moonI * night * atmo);
    u.uBright.value = S.gain;
    u.uPix.value = this.renderer.domElement.height / 900;
    u.uSize.value = lerp(0.60, 1, mid);
    u.uPxPerDeg.value = this.renderer.domElement.height / this.camera.fov * lerp(0.14, 1, mid);   // nebula glows stay small when the sky is seen from outside
    u.uTime.value = this.time;

    const sky = this.model.sky;
    if (sky) {
      sky.west.visible = S.lines === 'west'; sky.cn.visible = S.lines === 'cn';
      const guide = this.model.guides ? 1 - smoothstep(0.22, 0.58, S.zoom) : 0;     // armillary rings in the palm view
      const gl = (o, on, k) => { o.visible = on || guide * k > 0.01; o.material.uniforms.uAlpha.value = o.userData.a0 * Math.max(on ? 1 : 0, guide * k); };
      gl(sky.equator, S.equator || S.grid, 0.75); gl(sky.ecliptic, S.ecliptic || S.grid, 0.85); sky.grid.visible = !!S.grid;
      sky.dso.visible = !!S.dso;
      const gk = S.guide ? smoothstep(0.6, 0.86, S.zoom) * (1 - day) : 0;                  // the beginner's guide lines, from the ground only
      for (const o of [sky.guide, sky.pointer]) { o.visible = gk > 0.01; o.material.uniforms.uAlpha.value = o.userData.a0 * gk; }
      sky.trails.visible = S.trails !== 0; u.uSpan.value = S.trails * D2R;
    }
    this.cond = { sunAlt, moonAlt: Math.asin(moonSin) * R2D, moonHalo: moonI * 0.55 * night, moonI: moonFlux, day, atmo, night, lp };
    // exposure follows the Sun so daylight does not blow out, nights stay deep
    const ex = lerp(1.0, 0.20, smoothstep(-9, 5, sunAlt));
    this.post.settings.exposure = S.exposure * ex;
    this.post.settings.bloom = S.bloom; this.post.settings.vignette = S.vignette; this.post.settings.grain = S.grain;
  }

  // render-space position (fresh vector from a small ring)
  rp(v) { const o = this._pool[this._pi++ % this._pool.length]; return o.copy(v).sub(this.shift); }

  // --------------------------------------------------------------------- frame
  tick(dtReal) {
    const S = this.S;
    this.time += dtReal;
    if (S.playing) S.jd += dtReal * S.rate / 86400;
    // zoom: scripted journey or damped follow
    if (this._journey) {
      const j = this._journey, t = clamp((this.time - j.t0) / j.dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      S.zoom = S.zoomTarget = lerp(j.from, j.to, e);
      if (t >= 1) this._journey = null;
    } else {
      S.zoom += (S.zoomTarget - S.zoom) * (1 - Math.exp(-dtReal * 7));
      if (Math.abs(S.zoomTarget - S.zoom) < 1e-5) S.zoom = S.zoomTarget;
    }
    if (S.autorotate && S.zoom < 0.3 && !this._drag) { this._idle += dtReal; if (this._idle > 2.0) S.yaw += dtReal * 0.06; } else this._idle = 0;

    const eyeT = S.height + 1.7;
    if (Math.abs(this.eyeM - eyeT) > 1e-9) {                 // the observer rises (or sinks) smoothly, in log height
      const dl = Math.log(eyeT / this.eyeM);
      this.eyeM = Math.abs(dl) < 2e-3 ? eyeT : this.eyeM * Math.exp(dl * (1 - Math.exp(-dtReal * 2.6)));
      this.rebuildCurve();
    }
    const m = this.model, eph = this.eph.update(S.jd);
    const D = this.curve(S.zoom);
    const g = m.trueBlend ? m.trueBlend(D) : 0;
    const ctx = this.ctx = {
      app: this, eph, jd: S.jd, lat: S.lat, lon: S.lon, g, zoom: S.zoom, D, vh: this.renderer.domElement.height,
      time: this.time, cond: this.cond, shift: this.shift, rp: (v) => this.rp(v),
    };
    m.step(ctx);
    m.fx?.update(ctx, dtReal);

    // camera pose (model coords) -> floating origin
    const view = { yaw: S.yaw, pitch: S.pitch, az: S.az, alt: S.alt, fov: S.fov, fovOverview: m.fovOverview || 38 };
    journeyPose(m, this.curve, S.zoom, m.anchor, view, this.pose);
    this.shift.copy(this.pose.position);
    this.world.position.copy(this.shift).negate();
    this.world.updateMatrixWorld(true);
    const cam = this.camera;
    cam.position.set(0, 0, 0); cam.quaternion.copy(this.pose.quaternion);
    cam.fov = this.pose.fov; cam.near = Math.max(1e-10, Math.min(D * 1e-3, 1e-2)); cam.far = 1e7;
    // the composition leans away from whatever panel is open (palm view only)
    const vsT = (this.viewShiftTarget || 0) * (1 - smoothstep(0.45, 0.8, S.zoom)) + (this.viewShiftGround || 0) * smoothstep(0.45, 0.8, S.zoom);
    this._vs = (this._vs || 0) + (vsT - (this._vs || 0)) * (1 - Math.exp(-dtReal * 6));
    if (Math.abs(this._vs) > 0.4) cam.setViewOffset(innerWidth, innerHeight, -this._vs, 0, innerWidth, innerHeight); else if (cam.view) cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(cam.matrixWorld).invert();

    if (m.sky) { m.sky.u.uObs.value.copy(this.rp(m.anchor.pos)); m.sky.u.uCtr.value.copy(this.rp(m.skyCentre || this._zero)); }
    this.applyConditions(m.sky ? m.sky.u : {}, m.bodies);
    m.prepare(ctx, cam);
    m.fx?.prepare(cam);
    this.post.render(this.scene, cam, this.time);
    this.onFrame?.(ctx);
  }

  run() {
    const loop = (t) => {
      const dt = Math.min(0.1, (t - this._last) / 1000); this._last = t;
      this.tick(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------- readouts
  // What the active hypothesis predicts for named objects, next to what is really there.
  readout() {
    const m = this.model, S = this.S, e = this.eph;
    const frame = localFrame(S.lat, lstDeg(S.jd, S.lon));
    const out = { sunAlt: this.cond.sunAlt, moonAlt: this.cond.moonAlt, moonFraction: e.moonFraction, lst: lstDeg(S.jd, S.lon) };
    const pol = polarisOfDate(S.jd);
    const real = dirToHoriz(eqToVec(pol.ra, pol.dec), frame);
    out.polaris = { real };
    const p = m.objectPosition?.('polaris');
    if (p) out.polaris.model = m.horizontal(p);
    return out;
  }

  // The Sun and Moon at an arbitrary instant as the cosmology `model` predicts them from the observer's place, next to the real ones:
  //   { mine: {sun:{alt,az,dist}, moon}, real: {...}, radii: {sun, moon}, realRadii }   (dist in Earth radii)
  lumAt(jd, model = this.model, out = {}) {
    const S = this.S, e = this.ephB.update(jd);
    out.mine = model.skyAt(jd, e, S.lat, S.lon, out.mine || {});
    out.real = Cosmology.prototype.skyAt.call(model, jd, e, S.lat, S.lon, out.real || {});
    out.radii = model.lumRadii(); out.realRadii = Cosmology.prototype.lumRadii.call(model);
    return out;
  }

  // Model vs reality for the named objects, as seen from the observer right now.
  // Each row: { key, zh, real:{alt,az}, model:{alt,az}|null, err: degrees between the two directions }
  compare() {
    const m = this.model, S = this.S, e = this.eph;
    const fr = localFrame(S.lat, lstDeg(S.jd, S.lon), this._cf ??= {});
    const V = this._cv ??= new THREE.Vector3();
    const hz = (v, parallax) => dirToHoriz(parallax ? V.copy(v).sub(fr.up) : V.copy(v), fr);
    const pred = {}; for (const p of m.predictions?.() || []) pred[p.key] = p;
    const pol = polarisOfDate(S.jd);
    const items = [
      ['polaris', '北极星', eqToVec(pol.ra, pol.dec), false],
      ['galcentre', '银河中心', eqToVec(266.4168, -29.0078).applyMatrix4(e.P), false],
      ['sun', '太阳', e.sun, true], ['moon', '月亮', e.moon, true],
      ...PLANETS.map((p) => [p.id, p.zh, e.planets[p.id].geo, true]),
    ];
    const rows = [];
    for (const [key, zh, v, par] of items) {
      const real = hz(v, par);
      let model = null;
      if (pred[key]) model = pred[key].model;
      else { const p = m.objectPosition?.(key); if (p) model = m.horizontal(p); }
      let err = null;
      if (model) {
        const a1 = real.alt * D2R, a2 = model.alt * D2R, da = (real.az - model.az) * D2R;
        err = Math.acos(clamp(Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(da), -1, 1)) * R2D;
      }
      rows.push({ key, zh, real, model, err });
    }
    // lifted off the ground the horizon sinks below eye level on a curved Earth; on a flat plane it would stay level with the eye
    if (this.eyeM > 40) {
      const dip = horizonDip(this.eyeM), flat = m.id === 'flat';
      rows.unshift({ key: 'horizon', zh: '地平线', real: { alt: -dip, az: 0 }, model: { alt: flat ? 0 : -dip, az: 0 }, err: flat ? dip : 0,
        note: flat ? `现实：地平线在眼睛下方 ${dip.toFixed(1)}°，这里是 ${Math.round(this.eyeM)} 米高；平地说里它始终与眼睛齐平` : `一致 · 地平线沉到眼睛下方 ${dip.toFixed(2)}°` });
    }
    return rows;
  }

  // ------------------------------------------------------------------------ input
  #bindInput() {
    const el = this.canvas, S = this.S;
    let pts = new Map(), last = null;
    el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, ev); last = ev; this._drag = true; this._journey = null; });
    el.addEventListener('pointerup', (ev) => { pts.delete(ev.pointerId); if (!pts.size) this._drag = false; });
    el.addEventListener('pointercancel', (ev) => { pts.delete(ev.pointerId); if (!pts.size) this._drag = false; });
    el.addEventListener('pointermove', (ev) => {
      if (!pts.has(ev.pointerId)) return;
      const prev = pts.get(ev.pointerId); pts.set(ev.pointerId, ev);
      const dx = ev.clientX - prev.clientX, dy = ev.clientY - prev.clientY;
      if (pts.size === 2) return;                               // pinch handled by wheel-like logic below
      this._idle = 0;
      if (S.zoom < 0.84) {                                      // orbit the model
        S.yaw -= dx * 0.0052; S.pitch = clamp(S.pitch + dy * 0.0042, -1.45, 1.45);
      } else {                                                  // look around the sky
        const k = this.camera.fov / el.clientHeight;
        S.az = (S.az - dx * k + 360) % 360; S.alt = clamp(S.alt + dy * k, -89, 89.5);
      }
      this.emit('view');
    });
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const d = clamp(ev.deltaY, -240, 240);
      if (this.onWheel && this.onWheel(d)) return;
      if (S.zoomTarget > 0.985 && d < 0 && S.fov > 6) { S.fov = clamp(S.fov * Math.exp(d * 0.0016), 4, 110); this.emit('view'); return; }
      if (S.zoomTarget > 0.985 && d > 0 && S.fov < 74) { S.fov = clamp(S.fov * Math.exp(d * 0.0016), 4, 110); this.emit('view'); return; }
      this._journey = null;
      S.zoomTarget = clamp(S.zoomTarget - d * 0.00085, 0, 1);
      this.emit('zoom');
    }, { passive: false });
    el.addEventListener('dblclick', () => { this.journeyTo(S.zoomTarget > 0.5 ? 0 : 1, 3.2); });
    addEventListener('keydown', (ev) => {
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
      if (ev.code === 'Space') { S.playing = !S.playing; this.emit('state'); ev.preventDefault(); }
    });
  }
}
