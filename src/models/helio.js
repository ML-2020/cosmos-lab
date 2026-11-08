// 日心说 - the Copernican universe.
//
// The Sun stands at the centre.  The Earth is a planet: it spins once a day about an axis that keeps pointing the same
// way, and circles the Sun once a year; Mercury, Venus, Mars, Jupiter and Saturn circle it too.  Retrograde loops are
// the Earth overtaking (or being overtaken by) a neighbour: the lines of sight drawn from the Earth to each planet
// sweep backward when it does.  The stars are so far away that, from the ground, the sky is the familiar one.
//
// The model frame is the heliocentric inertial frame (equator of date: +Y is the celestial pole), 1 unit = 1 Earth radius.
// Positions are the real ephemeris, so this model *is* the reference the others are compared with.
import * as THREE from 'three';
import { Cosmology, Y_AXIS, polyLine, setOpacity, lerpLog } from './base.js';
import { SkyLayer } from '../sky.js';
import { EarthGlobe, EARTH_TEX } from '../earth.js';
import { Bodies } from '../bodies.js';
import { Ground, sampleGroundTint } from '../ground.js';
import { smoothstep, glowTexture } from '../util.js';
import { eqToVec, localFrame, lstDeg, D2R, OBLIQUITY, PLANETS, ELEMENTS, centuries, dirToHoriz, AU_R, SUN_RADIUS_KM, MOON_RADIUS_KM, R_EARTH_KM } from '../astro.js';

const ORBITS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'];
const HUE = { sun: 0xffc23d, mercury: 0xc9c2b4, venus: 0xfff1cf, earth: 0x6fd6ff, mars: 0xff8157, jupiter: 0xffdcae, saturn: 0xecd592, moon: 0xcfdcff };
const NAME = { sun: '太阳', mercury: '水星', venus: '金星', earth: '地球', mars: '火星', jupiter: '木星', saturn: '土星', moon: '月球' };
// display (palm) orbit radius of each planet, Earth radii
const RD = { mercury: 4.4, venus: 6.6, earth: 9.0, mars: 12.6, jupiter: 22, saturn: 31 };
const SHELL_D = 56;                                  // star sphere, palm size
const SHELL_T = 1e6;                                 // beyond Saturn (223,000), inside the far plane
const MOON_D = 2.3, MOON_T = 60.3;                   // Moon's orbit radius, palm / true
const A_TRUE = (id) => ELEMENTS[id][0] * AU_R;
const MOON_RAD = MOON_RADIUS_KM / R_EARTH_KM;

const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
let GLOW = null;
const mkDot = (color, size, opacity = 1) => {
  GLOW ??= glowTexture(128);
  const o = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: GLOW, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  o.frustumCulled = false; return o;
};
const mkSeg = (color, opacity) => {
  const o = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(color, opacity)); o.frustumCulled = false; return o;
};
const setSeg = (o, a, b) => { const p = o.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; };

// the orbital ellipse in ecliptic J2000 coordinates, AU
function orbitPoints(id, T, n = 360) {
  const el = ELEMENTS[id];
  const a = el[0] + el[1] * T, e = el[2] + el[3] * T, I = (el[4] + el[5] * T) * D2R;
  const varpi = (el[8] + el[9] * T) * D2R, Om = (el[10] + el[11] * T) * D2R, w = varpi - Om;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  const b = a * Math.sqrt(1 - e * e), pts = [];
  for (let i = 0; i < n; i++) {
    const E = (i / n) * Math.PI * 2, xp = a * (Math.cos(E) - e), yp = b * Math.sin(E);
    pts.push(new THREE.Vector3(
      xp * (cw * cO - sw * sO * cI) - yp * (sw * cO + cw * sO * cI),
      xp * (cw * sO + sw * cO * cI) - yp * (sw * sO - cw * cO * cI),
      xp * sw * sI + yp * cw * sI));
  }
  return pts;
}

export class HelioModel extends Cosmology {
  constructor(app) {
    super(app, { id: 'helio', zh: '日心说', en: 'Heliocentric', accent: '#ffcf5a', tag: '太阳居中 · 地球自转公转' });
    this.params = { orbits: true, sightlines: true };
    this.options = [
      { key: 'orbits', type: 'bool', label: '行星轨道', hint: '真实的开普勒椭圆（按展示比例压缩）' },
      { key: 'sightlines', type: 'bool', label: '地球→行星 视线', hint: '视线向后扫过时，行星在天上“逆行”' },
    ];
    const pole = new THREE.Vector3(0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY));      // ecliptic north in equatorial axes
    this.journey = {
      knots: [[0, 165], [0.14, 48], [0.30, 7.0], [0.50, 0.30], [0.68, 0.016], [0.84, 1.6e-4], [1, 1.7 / 6.371e6]],
      target: (o) => o.set(0, 0, 0), overviewUp: pole,
      targetZ: [0.12, 0.42], dirZ: [0.40, 0.82], fpZ: [0.80, 0.97],
    };
    this.overviewDefault = { yaw: 0.6, pitch: 0.55 };
    this.guides = true;
    this.fovOverview = 36;
    this._f = {};
    this._M = new THREE.Matrix4();
    const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
    this._E = new THREE.Matrix4().set(1, 0, 0, 0, 0, s, c, 0, 0, -c, s, 0, 0, 0, 0, 1);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._zero = new THREE.Vector3();
    this.skyCentre = new THREE.Vector3();
    this.pos = {}; this.earthPos = new THREE.Vector3();
    this._orbitT = null;
  }

  trueBlend(D) { return 1 - smoothstep(Math.log(0.25), Math.log(9), Math.log(D)); }

  build() {
    const skyU = this.app.skyU;
    this.earth = new EarthGlobe();
    this.sky = new SkyLayer({ place: (ra, dec, out) => eqToVec(ra, dec, 1000, out) });
    this.bodies = new Bodies(this.sky.u);
    this.ground = new Ground({ curvature: 1, capMax: 0.45, shared: skyU });
    this.group.add(this.earth.group, this.sky.group, this.bodies.group, this.ground.group);

    // ---- orbits, in the ecliptic frame (the group matrix = precession * ecliptic->equatorial); each ring scales about the Sun
    this.ecl = new THREE.Group(); this.ecl.matrixAutoUpdate = false; this.ecl.name = 'ecliptic-frame';
    this.group.add(this.ecl);
    const T = centuries(this.app.S.jd);
    this.ring = {};
    for (const id of ORBITS) {
      const r = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(orbitPoints(id, T)), lineMat(HUE[id], id === 'earth' ? 0.75 : 0.5));
      r.frustumCulled = false; this.ring[id] = r; this.ecl.add(r);
    }
    // ecliptic-plane disc: faint rings at the planet radii give the "plane of the planets" a surface
    const disc = this.disc = new THREE.Group();
    for (const k of [0.5, 1, 1.5, 2, 3, 4]) {
      const pts = []; for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * k, Math.sin(a) * k, 0)); }
      disc.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0x7fa6ff, 0.07)));
    }
    this.ecl.add(disc);

    // ---- planet markers, sightlines, Earth decoration
    this.dots = {}; this.sight = {};
    for (const id of [...ORBITS, 'moon']) { this.dots[id] = mkDot(HUE[id], id === 'earth' ? 1 : id === 'moon' ? 9 : 15); this.group.add(this.dots[id]); }
    this.dots.earth.visible = false;
    for (const p of PLANETS) { this.sight[p.id] = mkSeg(HUE[p.id], 0.38); this.group.add(this.sight[p.id]); }
    this.moonRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => { const a = i / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); })), lineMat(HUE.moon, 0.35));
    this.moonRing.frustumCulled = false; this.group.add(this.moonRing);

    const d = this.decor = new THREE.Group();
    this.axis = polyLine([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)], 0x59f0da, 0.7);   // Earth's axis
    this.equator = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => { const a = i / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35); })), lineMat(0x59f0da, 0.5));
    const gold = 0xffc23d;
    this.pin = new THREE.Group();
    this.pin.add(polyLine([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2.0, 0)], gold, 0.9));
    const tip = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2.0, 0)]),
      new THREE.PointsMaterial({ color: gold, size: 20, sizeAttenuation: false, map: glowTexture(128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pin.add(tip);
    d.add(this.axis, this.equator, this.pin);
    this.group.add(d);
    this.built = true;
  }

  // positions in model coordinates for scale blend g (0 palm, 1 true)
  _place(eph, g, out) {
    const sc = {};
    for (const id of ORBITS) { const a = A_TRUE(id); sc[id] = lerpLog(RD[id], a, g) / a; }
    out.sun ??= new THREE.Vector3(); out.sun.set(0, 0, 0);
    out.earth ??= new THREE.Vector3(); out.earth.copy(eph.earthHelio).multiplyScalar(sc.earth);
    for (const p of PLANETS) { out[p.id] ??= new THREE.Vector3(); out[p.id].copy(eph.planets[p.id].helio).multiplyScalar(sc[p.id]); }
    out.moon ??= new THREE.Vector3();
    out.moon.copy(eph.moon).multiplyScalar(lerpLog(MOON_D, MOON_T, g) / MOON_T).add(out.earth);
    out.sc = sc;
    return out;
  }

  step(ctx) {
    const { eph, jd, lat, lon, g, zoom } = ctx;
    const P = this.params;
    this._M.multiplyMatrices(eph.P, this._E);
    this.ecl.matrix.copy(this._M); this.ecl.matrixWorldNeedsUpdate = true;

    this._place(eph, g, this.pos);
    const pos = this.pos, E = pos.earth;
    this.earthPos.copy(E);
    this.sunPos.copy(pos.sun); this.moonPos.copy(pos.moon);

    // the observer rides the spinning Earth: inertial frame -> the local frame uses the sidereal time
    const f = localFrame(lat, lstDeg(jd, lon), this._f);
    const A = this.anchor;
    A.up.copy(f.up); A.north.copy(f.north); A.east.copy(f.east); A.pos.copy(E).add(f.up);
    this.earth.group.position.copy(E);
    this.earth.group.rotation.y = ((eph.gmst) * D2R);
    this.earth.setSun(this._a.copy(E).negate().normalize());

    // the star sphere is centred on the Sun in the palm view and on the observer on the ground
    const wT = smoothstep(this.journey.targetZ[0], this.journey.targetZ[1], zoom);
    this.skyCentre.copy(A.pos).multiplyScalar(wT);
    const shellR = lerpLog(SHELL_D, SHELL_T, g);
    this.sky.group.position.copy(this.skyCentre);
    this.sky.group.scale.setScalar(shellR / 1000);
    this.sky.u.uShellFade.value = smoothstep(0.95, 1.5, ctx.D / shellR);
    this.sky.j2000.matrix.copy(eph.P);

    this.planetList = PLANETS.map((p) => ({ id: p.id, pos: pos[p.id], mag: eph.planets[p.id].mag, color: new THREE.Color(p.color).toArray() }));

    const su = this.app.skyU;
    su.uSunDir.value.copy(pos.sun).sub(A.pos).normalize();
    su.uMoonDir.value.copy(pos.moon).sub(A.pos).normalize();
    su.uUp.value.copy(A.up);
    this.sunDir.copy(su.uSunDir.value); this.moonDir.copy(su.uMoonDir.value);

    this.ground.setFrame(A.pos, A.east, A.up, A.north);
    if (this._tintKey !== lat + ',' + lon && EARTH_TEX.day.image && EARTH_TEX.day.image.complete !== false) {
      this._tintKey = lat + ',' + lon;
      const t = sampleGroundTint(EARTH_TEX.day.image, lat, lon);
      this.ground.u.uTint.value.set(t[0] * 0.9 + 0.045, t[1] * 0.9 + 0.045, t[2] * 0.9 + 0.04);
    }
    this.ground.setAltitude(Math.max(0, ctx.D));

    // ---- overview objects
    const ov = 1 - smoothstep(0.30, 0.58, zoom);
    for (const id of ORBITS) {
      const k = AU_R * pos.sc[id];
      this.ring[id].scale.setScalar(k);
      this.ring[id].visible = P.orbits && ov > 0.004;
      this.ring[id].material.opacity = (id === 'earth' ? 0.75 : 0.5) * ov;
    }
    this.disc.scale.setScalar(AU_R * pos.sc.earth); this.disc.visible = P.orbits && ov > 0.004;
    this.disc.children.forEach((l) => { l.material.opacity = 0.07 * ov; });
    for (const id of ORBITS) if (id !== 'earth') { setDotV(this.dots[id], pos[id]); this.dots[id].visible = ov > 0.004; this.dots[id].material.opacity = ov; }
    setDotV(this.dots.moon, pos.moon); this.dots.moon.visible = ov > 0.004; this.dots.moon.material.opacity = ov;
    this.moonRing.position.copy(E); this.moonRing.scale.setScalar(lerpLog(MOON_D, MOON_T, g)); this.moonRing.visible = ov > 0.004;
    this.moonRing.material.opacity = 0.35 * ov;
    // the Moon's orbit lies near the ecliptic plane: tilt the ring by the ecliptic's inclination to the equator
    this.moonRing.quaternion.setFromUnitVectors(Y_AXIS, this._a.set(0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)));

    // sightlines from the Earth through each planet out to the star sphere: where they point on the sphere is where we see the planet
    for (const p of PLANETS) {
      const line = this.sight[p.id];
      line.visible = P.sightlines && ov > 0.004;
      if (!line.visible) continue;
      this._b.copy(pos[p.id]).sub(E).normalize();
      const far = this._c.copy(E).addScaledVector(this._b, shellR * 0.96);
      setSeg(line, E, far); line.material.opacity = 0.38 * ov;
    }

    // Earth decoration: axis (always the same way), equator, the observer's pin
    this.decor.position.copy(E);
    setOpacity(this.decor, 1 - smoothstep(0.34, 0.60, zoom));
    this.axis.scale.setScalar(1.9);
    this.pin.quaternion.setFromUnitVectors(Y_AXIS, A.up);

    this.app.applyConditions(this.sky.u, this.bodies);
  }

  prepare(ctx, camera) {
    const { g, vh, rp } = ctx;
    const rs = lerpLog(0.75, SUN_RADIUS_KM / R_EARTH_KM, g);
    this.bodies.setSun(rp(this.sunPos), rs, camera, vh, 3.2);
    const ov = 1 - smoothstep(0.22, 0.60, ctx.zoom);
    this.bodies.sunU.uGlow.value = 1 - 0.78 * ov;
    this.bodies.sunU.uInt.value = 1 - 0.62 * ov;
    const rm = lerpLog(0.20, MOON_RAD, g);
    this.bodies.setMoon(rp(this.moonPos), rm, rp(this.sunPos), rp(this.earthPos), camera, vh, ctx.cond.moonHalo, 3.2);
    this.bodies.setPlanets(this.planetList.map((p) => ({ pos: p.pos, mag: p.mag, color: p.color })));
    this.earth.u.uTime.value = ctx.time;
    this.earth.u.uPxAng.value = this.ground.u.uPxAng.value = 2 * Math.tan(camera.fov * Math.PI / 360) / vh;
    this.earth.haloU.uAlpha.value = smoothstep(0.03, 0.12, ctx.D);
    this.earth.halo.visible = ctx.D > 0.03;
    this.earth.mesh.visible = ctx.D > 8e-4;
  }

  // ---------------------------------------------------------------- what the model predicts
  objectPosition(key) {
    const eph = this.app.eph, A = this.anchor;
    const far = (ra, dec) => eqToVec(ra, dec, 1, this._a).applyMatrix4(eph.P).multiplyScalar(1e6).add(A.pos).clone();
    if (key === 'polaris') return far(37.9545, 89.2641);
    if (key === 'galcentre') return far(266.4168, -29.0078);
    if (key === 'sun') return this.pos.sun.clone();
    if (key === 'moon') return this.pos.moon.clone();
    if (this.pos[key]) return this.pos[key].clone();
    return null;
  }

  // The reference: with true distances the model's sky is, by construction, the ephemeris'.
  predictions() {
    const eph = this.app.eph, A = this.anchor;
    const obs = this._a.copy(eph.earthHelio).add(A.up);
    const out = [];
    const item = (key, zh, v) => {
      const d = dirToHoriz(this._b.copy(v).sub(obs), A);
      out.push({ key, zh, model: d, real: d, errDeg: 0 });
    };
    item('sun', '太阳', this._c.set(0, 0, 0));
    item('moon', '月亮', this._c.copy(eph.earthHelio).add(eph.moon));
    for (const p of PLANETS) item(p.id, p.zh, eph.planets[p.id].helio);
    return out;
  }

  labelItems() {
    const A = this.anchor, out = [];
    const pos = this.pos;
    for (const [t, dir] of [['北', A.north], ['东', A.east], ['南', A.north.clone().negate()], ['西', A.east.clone().negate()]]) {
      out.push({ kind: 'cardinal', text: t, pos: A.pos.clone().addScaledVector(dir, 1.62), model: true });
    }
    if (pos.sun) {
      out.push({ kind: 'model', text: NAME.sun, pos: pos.sun.clone().add(new THREE.Vector3(0, 2.2, 0)), hue: HUE.sun });
      for (const id of ORBITS) out.push({ kind: 'model', text: NAME[id], pos: pos[id].clone().add(new THREE.Vector3(0, id === 'earth' ? 2.4 : 1.1, 0)), hue: HUE[id] });
    }
    return out;
  }
}

function setDotV(o, v) { const p = o.geometry.attributes.position; p.setXYZ(0, v.x, v.y, v.z); p.needsUpdate = true; }
