// 地心说 - the Ptolemaic universe.
//
// The Earth sits motionless at the centre.  Around it, nested like the skins of an onion, lie the spheres of the
// Moon, Mercury, Venus, the Sun, Mars, Jupiter, Saturn and the fixed stars; the outermost turns once a day and
// carries everything with it.  Each wanderer is driven by Ptolemy's machinery (see ptolemy_mech.js): an eccentric
// deferent, an epicycle, an equant.  The retrograde loops of the planets are not an illusion in this universe,
// they are the epicycle.  Seen from the ground the sky is practically the real one - which is the point.
//
// Scale: the display scale compresses the nested spheres so they fit in your palm; descending, every sphere
// glides out to its Ptolemaic distance (the Planetary Hypotheses: Moon ~50, Sun ~1200, Saturn ~17000, stars ~20000
// Earth radii).  Each body's gear is scaled as a whole, so directions never change with scale.
import * as THREE from 'three';
import { Cosmology, Y_AXIS, polyLine, setOpacity, lerpLog } from './base.js';
import { SkyLayer } from '../sky.js';
import { EarthGlobe, EARTH_TEX } from '../earth.js';
import { Bodies } from '../bodies.js';
import { Ground, sampleGroundTint } from '../ground.js';
import { smoothstep, glowTexture, logDepth } from '../util.js';
import { eqToVec, localFrame, gmstDeg, D2R, OBLIQUITY, PLANETS, dirToHoriz } from '../astro.js';
import { PtolemaicSystem, RT, STARS_RT, sepDeg } from './ptolemy_mech.js';

const BODIES = ['moon', 'mercury', 'venus', 'sun', 'mars', 'jupiter', 'saturn'];
const SPHERE_NAME = { moon: '月天', mercury: '水星天', venus: '金星天', sun: '日天', mars: '火星天', jupiter: '木星天', saturn: '土星天', stars: '恒星天' };
const HUE = { moon: 0xcfdcff, mercury: 0xc9c2b4, venus: 0xfff1cf, sun: 0xffc23d, mars: 0xff8157, jupiter: 0xffdcae, saturn: 0xecd592, stars: 0x7fa6ff };
// display (palm) radius of each body's deferent, Earth radii
const RD = { moon: 2.4, mercury: 3.4, venus: 4.5, sun: 6.1, mars: 8.0, jupiter: 11.4, saturn: 14.8 };
const STARS_RD = 22;
const SUN_R_TRUE = RT.sun * Math.tan(0.2665 * D2R);
const MOON_R_TRUE = 0.2275;
// the span of each planet's path drawn on the sky (days) - a bit over one synodic period
const SPAN = { mercury: 150, venus: 700, mars: 900, jupiter: 470, saturn: 430 };
const NPATH = 240;

const SHELL_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform float uAlpha; uniform vec3 uCol;
varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  f = clamp(f, 0.0, 1.0);
  float a = (0.40 * pow(f, 9.0) + 0.010 * pow(f, 3.0)) * uAlpha;            // a glass skin: bright at the silhouette only
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

// ---- small drawing helpers (additive, never culled, updated in place)
const lineMat = (color, opacity, extra = {}) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });
function mkRing(color, opacity, seg = 192) {
  const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
  const o = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, opacity)); o.frustumCulled = false; return o;
}
function mkSeg(color, opacity) {
  const o = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(color, opacity)); o.frustumCulled = false; return o;
}
function setSeg(o, a, b) {
  const p = o.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
}
let GLOW = null;
function mkDot(color, size, opacity = 1) {
  GLOW ??= glowTexture(128);
  const o = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: GLOW, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  o.frustumCulled = false; return o;
}
function setDot(o, v) { const p = o.geometry.attributes.position; p.setXYZ(0, v.x, v.y, v.z); p.needsUpdate = true; }
function mkPath(color, n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const col = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), k = 0.10 + 0.90 * Math.exp(-(((t - 0.5) / 0.30) ** 2));
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const o = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
  o.frustumCulled = false; return o;
}
const _ex = new THREE.Vector3(), _ey = new THREE.Vector3(), _ez = new THREE.Vector3(), _bm = new THREE.Matrix4();
function planeQuat(Om, I, q) {
  const cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  _ex.set(cO, sO, 0); _ey.set(-sO * cI, cO * cI, sI); _ez.crossVectors(_ex, _ey);
  return q.setFromRotationMatrix(_bm.makeBasis(_ex, _ey, _ez));
}

class Gear {
  constructor(id) {
    this.id = id;
    const hue = HUE[id];
    this.root = new THREE.Group();
    const add = (o) => (this.root.add(o), o);
    this.def = add(mkRing(hue, 0.55));
    this.epi = add(mkRing(hue, 0.70));
    this.crank = id === 'moon' ? add(mkRing(hue, 0.25)) : null;
    this.lEC = add(mkSeg(hue, 0.28));
    this.lEP = add(mkSeg(hue, 0.65));
    this.lQ = add(mkSeg(0xffffff, 0.20));
    this.sight = add(mkSeg(hue, 0.40));
    this.dotC = add(mkDot(hue, 7, 0.55));
    this.dotQ = add(mkDot(0xffffff, 8, 0.8));
    this.dotP = add(mkDot(hue, id === 'sun' ? 26 : 17, 1));
    this.q = new THREE.Quaternion();
    this.path3 = id === 'sun' || id === 'moon' ? null : mkPath(hue, NPATH);       // the planet's track through the gear space
    if (this.path3) this.root.add(this.path3);
  }
}

export class PtolemyModel extends Cosmology {
  constructor(app) {
    super(app, { id: 'ptolemy', zh: '地心说', en: 'Ptolemaic', accent: '#b78cff', tag: '本轮 · 均轮 · 偏心匀速点' });
    this.sys = new PtolemaicSystem();
    this.params = { gears: true, paths: true, exact: false };
    this.options = [
      { key: 'gears', type: 'bool', label: '显示机械（均轮 · 本轮 · 匀速点）', hint: '关：只留下天球层' },
      { key: 'paths', type: 'bool', label: '行星轨迹（含逆行圈）', hint: '天球上近一个会合周期的路径' },
      { key: 'exact', type: 'bool', label: '用现实星历的方向摆放天体', hint: '关：天体由托勒密机械算出，与现实有些许偏差' },
    ];
    this.journey = {
      knots: [[0, 66], [0.14, 26], [0.30, 6.5], [0.50, 0.30], [0.68, 0.016], [0.84, 1.6e-4], [1, 1.7 / 6.371e6]],
      target: (o) => o.set(0, 0, 0), overviewUp: new THREE.Vector3(0, 1, 0),
      targetZ: [0.12, 0.42], dirZ: [0.40, 0.82], fpZ: [0.80, 0.97],
    };
    this.overviewDefault = { yaw: 0.72, pitch: 0.46 };
    this.guides = true;
    this.fovOverview = 36;
    this._f = {};
    this._M = new THREE.Matrix4(); this._Ry = new THREE.Matrix4();
    // ecliptic (J2000, x equinox, z pole) -> equatorial J2000 scene axes: (x, y*s + z*c, -y*c + z*s)
    const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
    this._E = new THREE.Matrix4().set(1, 0, 0, 0, 0, s, c, 0, 0, -c, s, 0, 0, 0, 0, 1);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._zero = new THREE.Vector3();
    this.mech = null; this.pos = {}; this._pathKey = {};
    this._gm = 0;
  }

  trueBlend(D) { return 1 - smoothstep(Math.log(0.25), Math.log(9), Math.log(D)); }

  build() {
    const skyU = this.app.skyU;
    this.earth = new EarthGlobe();
    this.sky = new SkyLayer({ place: (ra, dec, out) => eqToVec(ra, dec, 1000, out) });
    this.bodies = new Bodies(this.sky.u);
    this.ground = new Ground({ curvature: 1, capMax: 0.45, shared: skyU });
    this.group.add(this.earth.group, this.sky.group, this.bodies.group, this.ground.group);

    // ---- the nested spheres (outer skin of each body's domain) and the stars
    this.shellU = {}; this.shells = {};
    const geo = new THREE.SphereGeometry(1, 96, 48);
    for (const b of [...BODIES, 'stars']) {
      const u = this.shellU[b] = { uAlpha: { value: 1 }, uCol: { value: new THREE.Color(HUE[b]) } };
      const m = this.shells[b] = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, ...logDepth(SHELL_VERT, SHELL_FRAG), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = -28; m.frustumCulled = false; this.group.add(m);
    }

    // ---- the machinery, in the ecliptic frame (the group matrix carries it into place each frame)
    this.ecl = new THREE.Group(); this.ecl.name = 'ecliptic-frame'; this.ecl.matrixAutoUpdate = false;
    this.group.add(this.ecl);
    this.gear = {};
    for (const b of BODIES) { this.gear[b] = new Gear(b); this.ecl.add(this.gear[b].root); }
    this.skyPath = {};
    for (const p of PLANETS) { this.skyPath[p.id] = mkPath(HUE[p.id], NPATH); this.ecl.add(this.skyPath[p.id]); }

    // ---- overview decoration: axis, equator, observer pin and horizon
    const d = this.decor = new THREE.Group();
    const cyan = 0x59f0da, gold = 0xffc23d;
    this.axis = polyLine([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)], cyan, 0.30);
    this.axis.frustumCulled = false;
    d.add(this.axis);
    this.pin = new THREE.Group();
    this.pin.add(polyLine([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2.1, 0)], gold, 0.9));
    const tip = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2.1, 0)]),
      new THREE.PointsMaterial({ color: gold, size: 22, sizeAttenuation: false, map: glowTexture(128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pin.add(tip);
    this.horizon = new THREE.Group();
    const hr = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2; hr.push(new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)); }
    this.horizon.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hr), new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.55, depthWrite: false })));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this.horizon.add(polyLine([new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5), new THREE.Vector3(Math.cos(a) * 1.72, 0, Math.sin(a) * 1.72)], gold, 0.9));
    }
    d.add(this.pin, this.horizon);
    this.group.add(d);
    this.built = true;
  }

  // inertial (equator of date) vector -> Earth-fixed scene position of the given length
  _ef(v, len, out) { return out.copy(v).normalize().applyAxisAngle(Y_AXIS, -this._gm).multiplyScalar(len); }

  // mechanism outputs for this instant (ecliptic J2000, deferent units) - independent of scale
  _mechanism(jd) {
    const sys = this.sys, m = { sun: sys.sun(jd, {}), moon: sys.moon(jd, {}), pl: {} };
    for (const p of PLANETS) m.pl[p.id] = sys.planet(p.id, jd, {});
    return m;
  }

  // body positions in Earth-fixed model coordinates for a given scale blend g (0 palm, 1 true Ptolemaic distances)
  _positions(m, eph, g, exact, out) {
    const R = (b) => lerpLog(RD[b], RT[b], g);
    const place = (vecEcl, ref, k, key, inertial) => {
      const o = out[key] ??= new THREE.Vector3();
      if (exact && inertial) return this._ef(inertial, vecEcl.length() * k, o);
      return o.copy(vecEcl).multiplyScalar(k).applyMatrix4(this._M);
    };
    place(m.sun.S, 1, R('sun'), 'sun', eph.sun);
    place(m.moon.moon, 1, R('moon'), 'moon', eph.moon);
    for (const p of PLANETS) place(m.pl[p.id].planet, m.pl[p.id].scaleRef, R(p.id) / m.pl[p.id].scaleRef, p.id, eph.planets[p.id].geo);
    return out;
  }

  _updatePaths(jd, shellR, k) {
    const sys = this.sys;
    for (const p of PLANETS) {
      const span = SPAN[p.id], step = span / (NPATH - 1);
      const base = Math.floor((jd - span / 2) / step);
      if (this._pathKey[p.id] !== base) {
        this._pathKey[p.id] = base;
        const sp = this.skyPath[p.id].geometry.attributes.position, g3 = this.gear[p.id].path3.geometry.attributes.position;
        for (let i = 0; i < NPATH; i++) {
          const o = sys.planet(p.id, (base + i) * step, {}), v = o.planet;
          const L = v.length() || 1;
          sp.setXYZ(i, v.x / L, v.y / L, v.z / L);
          g3.setXYZ(i, v.x, v.y, v.z);
        }
        sp.needsUpdate = true; g3.needsUpdate = true;
      }
      this.skyPath[p.id].scale.setScalar(shellR * 0.992);
    }
  }

  step(ctx) {
    const { eph, jd, lat, lon, g, zoom } = ctx;
    const gm = this._gm = gmstDeg(jd) * D2R;
    // M carries ecliptic-J2000 machinery coordinates into the Earth-fixed frame: spin(-GMST) * precession * ecliptic->equatorial
    this._M.multiplyMatrices(this._Ry.makeRotationY(-gm), eph.P).multiply(this._E);
    this.ecl.matrix.copy(this._M); this.ecl.matrixWorldNeedsUpdate = true;

    const shellR = lerpLog(STARS_RD, STARS_RT, g);
    this.sky.group.rotation.y = -gm;
    this.sky.group.scale.setScalar(shellR / 1000);
    this.sky.u.uShellFade.value = smoothstep(0.95, 1.5, ctx.D / shellR);
    this.sky.j2000.matrix.copy(eph.P);

    const f = localFrame(lat, lon, this._f);
    const A = this.anchor;
    A.up.copy(f.up); A.north.copy(f.north); A.east.copy(f.east); A.pos.copy(f.up);

    const m = this.mech = this._mechanism(jd);
    this._positions(m, eph, g, this.params.exact, this.pos);
    this.sunPos.copy(this.pos.sun); this.moonPos.copy(this.pos.moon);
    this.earth.setSun(this._a.copy(this.sunPos).normalize());
    this.planetList = PLANETS.map((p) => ({ id: p.id, pos: this.pos[p.id], mag: eph.planets[p.id].mag, color: new THREE.Color(p.color).toArray() }));

    const su = this.app.skyU;
    su.uSunDir.value.copy(this.sunPos).sub(A.pos).normalize();
    su.uMoonDir.value.copy(this.moonPos).sub(A.pos).normalize();
    su.uUp.value.copy(A.up);
    this.sunDir.copy(su.uSunDir.value); this.moonDir.copy(su.uMoonDir.value);

    this.ground.setFrame(A.pos, A.east, A.up, A.north);
    if (this._tintKey !== lat + ',' + lon && EARTH_TEX.day.image && EARTH_TEX.day.image.complete !== false) {
      this._tintKey = lat + ',' + lon;
      const t = sampleGroundTint(EARTH_TEX.day.image, lat, lon);
      this.ground.u.uTint.value.set(t[0] * 0.9 + 0.045, t[1] * 0.9 + 0.045, t[2] * 0.9 + 0.04);
    }
    this.ground.setAltitude(Math.max(0, ctx.D));

    // ---- the machinery
    const ov = 1 - smoothstep(0.30, 0.58, zoom);
    this._ov = ov;
    const R = (b) => lerpLog(RD[b], RT[b], g);
    const far = shellR;
    const kOf = {}, S = m.sun, Mo = m.moon;
    for (const b of BODIES) {
      const G = this.gear[b];
      const refs = b === 'sun' ? S : b === 'moon' ? Mo : m.pl[b];
      const k = kOf[b] = R(b) / (refs.scaleRef ?? 1);
      G.root.scale.setScalar(k);
      G.root.visible = this.params.gears && ov > 0.004;
      if (!G.root.visible) continue;
      const O = this._zero;
      const dirFar = (v) => this._a.copy(v).normalize().multiplyScalar(far / k);
      if (b === 'sun') {
        G.def.position.copy(S.C); G.def.scale.setScalar(1); G.def.quaternion.identity();
        G.epi.visible = false; G.lQ.visible = false; G.dotQ.visible = false; G.dotC.visible = true;
        setSeg(G.lEC, O, S.S); setSeg(G.lEP, S.S, S.S); setSeg(G.sight, S.S, dirFar(S.S));
        setDot(G.dotC, S.C); setDot(G.dotP, S.S);
      } else if (b === 'moon') {
        planeQuat(Mo.plane.Om, Mo.plane.I, G.q);
        G.def.position.copy(Mo.C); G.def.scale.setScalar(Mo.R); G.def.quaternion.copy(G.q);
        G.epi.position.copy(Mo.epiCentre); G.epi.scale.setScalar(Mo.r); G.epi.quaternion.copy(G.q); G.epi.visible = true;
        G.crank.position.set(0, 0, 0); G.crank.scale.setScalar(Mo.e); G.crank.quaternion.copy(G.q);
        G.lQ.visible = true; G.dotQ.visible = false; G.dotC.visible = true;
        setSeg(G.lEC, O, Mo.epiCentre); setSeg(G.lEP, Mo.epiCentre, Mo.moon); setSeg(G.lQ, O, Mo.C); setSeg(G.sight, O, dirFar(Mo.moon));
        setDot(G.dotC, Mo.C); setDot(G.dotP, Mo.moon);
      } else {
        const P = m.pl[b];
        G.epi.visible = true; G.lQ.visible = true; G.dotQ.visible = true; G.dotC.visible = true;
        if (P.kind === 'superior') {
          planeQuat(P.deferent.Om, P.deferent.I, G.q);
          G.def.position.copy(P.deferent.C); G.def.scale.setScalar(P.deferent.R); G.def.quaternion.copy(G.q);
          G.epi.position.copy(P.epiCentre); G.epi.scale.setScalar(P.epiR); G.epi.quaternion.identity();
          setSeg(G.lQ, P.equant, P.epiCentre); setDot(G.dotC, P.deferent.C);
        } else {
          G.def.position.copy(P.deferent.C); G.def.scale.setScalar(1); G.def.quaternion.identity();
          planeQuat(P.plane.Om, P.plane.I, G.q);
          G.epi.position.copy(P.epiCentreOffset); G.epi.scale.setScalar(P.epiR); G.epi.quaternion.copy(G.q);
          setSeg(G.lQ, P.equant, P.planet); setDot(G.dotC, P.deferent.C);
        }
        setSeg(G.lEC, O, P.epiCentre); setSeg(G.lEP, P.epiCentre, P.planet); setSeg(G.sight, O, dirFar(P.planet));
        setDot(G.dotQ, P.equant); setDot(G.dotP, P.planet);
      }
      setOpacity(G.root, ov);
      G.root.visible = this.params.gears && ov > 0.004;
    }

    // planet paths on the sky and through the gears
    const showPaths = this.params.paths;
    for (const p of PLANETS) { this.skyPath[p.id].visible = showPaths; this.gear[p.id].path3 && (this.gear[p.id].path3.visible = showPaths); }
    if (showPaths) this._updatePaths(jd, shellR, kOf);
    const day = this.app.cond?.day ?? 0;
    const pk = (1 - 0.78 * smoothstep(0.3, 0.9, zoom)) * (1 - 0.85 * day);
    for (const p of PLANETS) this.skyPath[p.id].material.opacity = 0.9 * pk;

    // nested spheres
    const shellK = ov;
    for (const b of BODIES) {
      const refs = b === 'sun' ? S : b === 'moon' ? Mo : m.pl[b];
      this.shells[b].scale.setScalar(Math.max(0.01, refs.env.max * kOf[b]));
      this.shellU[b].uAlpha.value = shellK * (b === 'sun' || b === 'moon' ? 0.9 : 0.75);
      this.shells[b].visible = shellK > 0.004;
    }
    this.shells.stars.scale.setScalar(shellR);
    this.shellU.stars.uAlpha.value = shellK;
    this.shells.stars.visible = shellK > 0.004;

    // decoration
    const kk = 1 - smoothstep(0.34, 0.60, zoom);
    setOpacity(this.decor, kk);
    this.axis.scale.y = shellR * 1.1;
    this.pin.quaternion.setFromUnitVectors(Y_AXIS, A.up);
    this.horizon.position.copy(A.pos);
    this.horizon.quaternion.setFromUnitVectors(Y_AXIS, A.up);
    const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.horizon.quaternion);
    const ang = Math.atan2(new THREE.Vector3().crossVectors(xAxis, A.east).dot(A.up), xAxis.dot(A.east));
    this.horizon.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(A.up, ang));

    this.app.applyConditions(this.sky.u, this.bodies);
  }

  prepare(ctx, camera) {
    const { g, vh, rp } = ctx;
    const rs = lerpLog(0.38, SUN_R_TRUE, g);
    this.bodies.setSun(rp(this.sunPos), rs, camera, vh, 3.2);
    const ov = 1 - smoothstep(0.22, 0.60, ctx.zoom);
    this.bodies.sunU.uGlow.value = 1 - 0.78 * ov;
    this.bodies.sunU.uInt.value = 1 - 0.62 * ov;
    // the Moon keeps its true radius: at the near end of its swing the model's Moon is nearly twice as big as at the far end
    const rm = lerpLog(0.16, MOON_R_TRUE, g);
    this.bodies.setMoon(rp(this.moonPos), rm, rp(this.sunPos), rp(this._zero), camera, vh, ctx.cond.moonHalo, 3.2);
    this.bodies.setPlanets(this.planetList.map((p) => ({ pos: p.pos, mag: p.mag, color: p.color })));
    this.earth.u.uTime.value = ctx.time;
    this.earth.u.uPxAng.value = this.ground.u.uPxAng.value = 2 * Math.tan(camera.fov * Math.PI / 360) / vh;
    this.earth.haloU.uAlpha.value = smoothstep(0.03, 0.12, ctx.D);
    this.earth.halo.visible = ctx.D > 0.03;
    this.earth.mesh.visible = ctx.D > 8e-4;
  }

  // ---------------------------------------------------------------- what the model predicts
  objectPosition(key) {
    const eph = this.app.eph;
    if (key === 'polaris') return this._ef(eqToVec(37.9545, 89.2641, 1, new THREE.Vector3()).applyMatrix4(eph.P), 1e6, new THREE.Vector3());
    if (key === 'galcentre') return this._ef(eqToVec(266.4168, -29.0078, 1, new THREE.Vector3()).applyMatrix4(eph.P), 1e6, new THREE.Vector3());
    if (key === 'sun') return this.sunPos.clone();
    if (key === 'moon') return this.moonPos.clone();
    if (this.pos[key]) return this.pos[key].clone();
    return null;
  }

  // Model vs reality for the Sun, Moon and planets as seen by the observer (true Ptolemaic distances, so the
  // Moon's parallax - different from the real one - is included).
  predictions() {
    const eph = this.app.eph, A = this.anchor;
    if (!this.mech) return [];
    const mine = this._positions(this.mech, eph, 1, this.params.exact, {});
    const out = [];
    const items = [['sun', '太阳', eph.sun], ['moon', '月亮', eph.moon], ...PLANETS.map((p) => [p.id, p.zh, eph.planets[p.id].geo])];
    for (const [id, zh, v] of items) {
      const model = dirToHoriz(this._b.copy(mine[id]).sub(A.pos), A);
      const real = dirToHoriz(this._ef(v, v.length(), this._c).sub(A.pos), A);
      const dm = this._b.copy(mine[id]).normalize(), dr = this._ef(v, 1, this._d);
      out.push({ key: id, zh, model, real, errDeg: sepDeg(dm, dr) });
    }
    return out;
  }

  lumRadii() { return { sun: SUN_R_TRUE, moon: MOON_R_TRUE }; }

  // The Sun and Moon at jd as the Ptolemaic machine has them (true Ptolemaic distances), seen from (lat, lon).
  skyAt(jd, eph, lat, lon, out = {}) {
    const gm = gmstDeg(jd) * D2R, f = localFrame(lat, lon, this._sf ??= {});
    const M = (this._Ma ??= new THREE.Matrix4()).multiplyMatrices(this._Ry.makeRotationY(-gm), eph.P).multiply(this._E);
    const sun = this.sys.sun(jd, {}), moon = this.sys.moon(jd, {});
    for (const [key, vecEcl, k, inertial] of [['sun', sun.S, RT.sun, eph.sun], ['moon', moon.moon, RT.moon, eph.moon]]) {
      const pos = new THREE.Vector3();
      if (this.params.exact) pos.copy(inertial).normalize().applyAxisAngle(Y_AXIS, -gm).multiplyScalar(vecEcl.length() * k);
      else pos.copy(vecEcl).multiplyScalar(k).applyMatrix4(M);
      pos.sub(f.up);
      const h = dirToHoriz(pos, f);
      out[key] = { alt: h.alt, az: h.az, dist: pos.length() };
    }
    return out;
  }

  // apparent angular diameter of the Moon (degrees) as the model has it and as it really is
  moonSize() {
    const A = this.anchor, eph = this.app.eph;
    if (!this.mech) return null;
    const mine = this._positions(this.mech, eph, 1, false, {}).moon.distanceTo(A.pos);
    const real = this._ef(eph.moon, eph.moon.length(), this._c).distanceTo(A.pos);
    return { model: 2 * Math.atan(MOON_R_TRUE / mine) / D2R, real: 2 * Math.atan(1737.4 / 6371 / real) / D2R };
  }

  labelItems() {
    const A = this.anchor, out = [];
    for (const [t, dir] of [['北', A.north], ['东', A.east], ['南', A.north.clone().negate()], ['西', A.east.clone().negate()]]) {
      out.push({ kind: 'cardinal', text: t, pos: A.pos.clone().addScaledVector(dir, 1.62), model: true });
    }
    if (this.mech) {
      const g = this.app.ctx?.g ?? 0;
      let i = 0;
      for (const b of [...BODIES, 'stars']) {
        const r = b === 'stars' ? lerpLog(STARS_RD, STARS_RT, g) * 1.0 : this.shells[b].scale.x;
        const a = 0.9 + i * 0.62, el = 0.30 + (i % 3) * 0.12;
        out.push({ kind: 'model', text: SPHERE_NAME[b], pos: new THREE.Vector3(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)).multiplyScalar(r), hue: HUE[b] });
        i++;
      }
    }
    return out;
  }
}
