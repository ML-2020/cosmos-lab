// 地平说 - the flat-earth cosmology, taken at its word.
//
//   * The Earth is a disc in azimuthal-equidistant projection: the north pole at the centre, 1 degree of
//     latitude = 111.19 km along every meridian, the south pole smeared into the rim (ice wall, r = 20,015 km).
//   * Over it stands a dome.  Every celestial object hangs above the spot on the map that lies under it in
//     reality: the point with latitude = declination and longitude = RA - GMST (the sub-stellar, sub-solar,
//     sub-lunar point).  Stars on the outer dome, Moon / Sun / planets on lower concentric domes.
//   * From the ground you see each object at the true geometric angle (raw geometry).  Real skies show rising and
//     setting, which a flat sky cannot do, so the model's defenders add a "perspective" patch: an object reaches the
//     horizon at a vanishing distance L.  The patch is switchable; both versions are honest predictions to compare
//     with the real sky (see horizontal() / objectPosition() and the readouts).
//
// Star coordinates here are J2000 (precession is a rotation of the sphere; a dome has no such symmetry), and the
// Sun, Moon and planets are expressed in the same J2000 frame so they stay consistent with the stars.
import * as THREE from 'three';
import { Cosmology, Y_AXIS, ringLine, polyLine, setOpacity } from './base.js';
import { SkyLayer } from '../sky.js';
import { FlatEarth, EARTH_TEX } from '../earth.js';
import { Bodies } from '../bodies.js';
import { Ground, sampleGroundTint } from '../ground.js';
import { smoothstep, glowTexture, logDepth, clamp, lerp } from '../util.js';
import { D2R, gmstDeg, PLANETS, dirToHoriz } from '../astro.js';

const R = Math.PI;                    // disc radius, Earth radii (1 radius = 6371 km, 1 degree = 111.19 km)
const KM = 6371;
// height of each object's dome as a fraction of the star dome
const F = { sun: 0.80, moon: 0.76, mercury: 0.84, venus: 0.86, mars: 0.88, jupiter: 0.90, saturn: 0.92 };

const DOME_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz; vY = position.y;
  gl_Position = projectionMatrix * mv;
}`;
const DOME_FRAG = /* glsl */ `
uniform float uAlpha; uniform vec3 uCol;
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(clamp(f, 0.0, 1.0), 2.6);
  float low = pow(1.0 - clamp(vY, 0.0, 1.0), 3.0);               // glows toward the horizon where it meets the wall
  float a = (0.030 + 0.40 * rim + 0.16 * low) * uAlpha;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const WALL_VERT = /* glsl */ `
varying vec3 vP; varying vec3 vN2; varying vec3 vV;
void main(){
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN2 = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const WALL_FRAG = /* glsl */ `
uniform float uAlpha, uH;
varying vec3 vP; varying vec3 vN2; varying vec3 vV;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  float t = vP.y / uH;                                              // 0 at the ground, 1 at the crest
  float ang = atan(vP.z, vP.x);
  float n = h1(floor(ang * 160.0)) * 0.6 + h1(floor(ang * 41.0) + 7.0) * 0.4;
  float glow = (0.35 + 0.65 * n) * (1.0 - 0.55 * t) + 0.9 * smoothstep(0.92, 1.0, t);
  float face = abs(dot(normalize(vN2), normalize(vV)));
  vec3 c = mix(vec3(0.62, 0.86, 1.0), vec3(1.0), smoothstep(0.7, 1.0, t)) * glow * (0.45 + 0.55 * face);
  gl_FragColor = vec4(c * uAlpha, 1.0);
}`;

export class FlatModel extends Cosmology {
  constructor(app) {
    super(app, { id: 'flat', zh: '地平说', en: 'Flat Earth', accent: '#ffb23d', tag: '圆盘 · 冰墙 · 穹顶' });
    this.params = { patch: true, vanishKm: 10008, domeH: 1.0 };
    this.options = [
      { key: 'patch', type: 'bool', label: '透视消失（辩护补丁）', hint: '开：天体在消失距离处落到地平线；关：纯几何，天体永不落下' },
      { key: 'vanishKm', type: 'range', min: 4000, max: 20000, step: 100, label: '消失距离 (km)' },
      { key: 'domeH', type: 'range', min: 0.4, max: 2.2, step: 0.05, label: '穹顶高度 (×地球半径)' },
    ];
    this.journey = {
      knots: [[0, 8.6], [0.14, 5.2], [0.30, 2.0], [0.50, 0.22], [0.68, 0.012], [0.84, 1.2e-4], [1, 1.7 / 6.371e6]],
      target: (o) => o.set(0, 0.28, 0), overviewUp: new THREE.Vector3(0, 1, 0),
      targetZ: [0.12, 0.42], dirZ: [0.40, 0.82], fpZ: [0.80, 0.97],
    };
    this.overviewDefault = { yaw: 0.35, pitch: 0.62 };
    this.guides = false;
    this._Pinv = new THREE.Matrix4();
    this._t = new THREE.Vector3(); this._pv = new THREE.Vector3(); this._gm = 0;
    this.sunApp = new THREE.Vector3(); this.moonApp = new THREE.Vector3();
  }

  trueBlend() { return 0; }

  // the disc: distance from the centre = colatitude (1 rad = 1 Earth radius), angle = longitude; height is height above the disc
  earthPoint(u, hKm, out) {
    const rho = Math.PI / 2 - Math.asin(clamp(u.y, -1, 1)), d = Math.hypot(u.x, u.z);
    return out.set(d > 1e-9 ? rho * u.x / d : 0, hKm / KM, d > 1e-9 ? rho * u.z / d : 0);
  }
  earthPath(u0, u1, n, hKm, out = []) {
    const a = this.earthPoint(u0, hKm, new THREE.Vector3()), b = this.earthPoint(u1, hKm, new THREE.Vector3());
    for (let i = 0; i <= n; i++) out[i] = (out[i] || new THREE.Vector3()).lerpVectors(a, b, i / n);
    return out;
  }

  build() {
    const skyU = this.app.skyU;
    this.earth = new FlatEarth(R);
    this.earth.mesh.position.y = -4e-6;                                  // never coplanar with the ground cap
    this.sky = new SkyLayer({
      place: (ra, dec, out) => {                                          // inertial frame; the group turns it by -GMST
        const rho = Math.PI / 2 - dec * D2R, a = ra * D2R;
        return out.set(rho * Math.cos(a), Math.sqrt(Math.max(0, 1 - (rho / R) ** 2)), -rho * Math.sin(a));
      },
    });
    this.bodies = new Bodies(this.sky.u);
    this.ground = new Ground({ curvature: Infinity, capMax: 0.5, clipR: R, shared: skyU });
    this.group.add(this.earth.group, this.sky.group, this.bodies.group, this.ground.group);

    // ---- dome (translucent ellipsoid) and ice wall
    this.domeU = { uAlpha: { value: 1 }, uCol: { value: new THREE.Color(0.38, 0.62, 1.0) } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 40, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: this.domeU, ...logDepth(DOME_VERT, DOME_FRAG), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dome.renderOrder = -30; this.dome.frustumCulled = false;
    const wallH = 0.035;
    this.wallU = { uAlpha: { value: 1 }, uH: { value: wallH } };
    const wallGeo = new THREE.CylinderGeometry(R, R, wallH, 256, 1, true); wallGeo.translate(0, wallH / 2, 0);
    this.wall = new THREE.Mesh(wallGeo, new THREE.ShaderMaterial({ uniforms: this.wallU, ...logDepth(WALL_VERT, WALL_FRAG), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.wall.renderOrder = -29; this.wall.frustumCulled = false;
    this.group.add(this.dome, this.wall);

    // ---- overview decoration: axis, meridian of the observer, observer pin, paths of Sun and Moon
    const d = this.decor = new THREE.Group();
    const cyan = 0x59f0da, gold = 0xffc23d;
    this.axis = polyLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)], cyan, 0.45);
    d.add(this.axis);
    this.meridian = new THREE.Group();
    this.meridian.add(polyLine([new THREE.Vector3(0, 0.0005, 0), new THREE.Vector3(R, 0.0005, 0)], 0xbfd2ff, 0.4));
    d.add(this.meridian);
    this.sunRing = ringLine(1, gold, 0.5, 256); this.moonRing = ringLine(1, 0xdce6ff, 0.35, 256);
    d.add(this.sunRing, this.moonRing);
    this.pin = new THREE.Group();
    this.pin.add(polyLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.34, 0)], gold, 0.9));
    this.pin.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.34, 0)]),
      new THREE.PointsMaterial({ color: gold, size: 22, sizeAttenuation: false, map: glowTexture(128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    this.horizon = new THREE.Group();
    this.horizon.add(ringLine(0.16, gold, 0.6));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this.horizon.add(polyLine([new THREE.Vector3(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16), new THREE.Vector3(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2)], gold, 0.9));
    }
    d.add(this.pin);
    d.add(this.horizon);
    this.group.add(d);
    this.built = true;
  }

  // perspective patch on the CPU (mirror of skyWorld() in sky.js); up is +Y here
  _persp(p, obs, k, L, out) {
    if (k < 1e-3) return out.copy(p);
    const v = this._pv.copy(p).sub(obs), h = v.y, dh = Math.hypot(v.x, v.z), len = v.length();
    const e = Math.atan2(h, dh), eL = Math.atan2(h, L);
    let e2;
    if (e >= eL) e2 = (e - eL) / (1 - eL / (Math.PI / 2));
    else { const t = clamp((dh - L) / L / 0.2, 0, 1); e2 = -(Math.PI / 2) * t * t * (3 - 2 * t); }   // beyond L it has vanished
    const ee = e + (e2 - e) * k;
    const hx = dh > 1e-9 ? v.x / dh : 0, hz = dh > 1e-9 ? v.z / dh : 0;
    return out.set(obs.x + hx * Math.cos(ee) * len, obs.y + Math.sin(ee) * len, obs.z + hz * Math.cos(ee) * len);
  }

  // inertial (equator of date) direction -> the object's place on its dome (model coords)
  _place(v, f, out, Pinv = this._Pinv, gm = this._gm) {
    this._t.copy(v).normalize().applyMatrix4(Pinv);
    const dec = Math.asin(clamp(this._t.y, -1, 1)), ra = Math.atan2(-this._t.z, this._t.x);
    const rho = Math.PI / 2 - dec, lonE = ra - gm;
    return out.set(rho * Math.cos(lonE), f * this.params.domeH * Math.sqrt(Math.max(0, 1 - (rho / R) ** 2)), -rho * Math.sin(lonE));
  }

  step(ctx) {
    const { eph, jd, lat, lon, zoom } = ctx;
    const P = this.params, H = P.domeH, L = P.vanishKm / KM;
    const gm = this._gm = gmstDeg(jd) * D2R;
    this._Pinv.copy(eph.P).transpose();

    this.sky.group.rotation.y = -gm;
    this.sky.group.scale.set(1, H, 1);
    this.sky.j2000.matrix.identity();

    // observer on the disc
    const A = this.anchor, latR = lat * D2R, lonR = lon * D2R, rho = Math.PI / 2 - latR;
    A.pos.set(rho * Math.cos(lonR), 0, -rho * Math.sin(lonR));
    A.up.set(0, 1, 0);
    A.north.set(-Math.cos(lonR), 0, Math.sin(lonR));
    A.east.set(-Math.sin(lonR), 0, -Math.cos(lonR));
    this.rho = rho;

    // luminaries on their domes (raw geometry) and as perceived (perspective patch)
    this._place(eph.sun, F.sun, this.sunPos);
    this._place(eph.moon, F.moon, this.moonPos);
    this.planetList = PLANETS.map((p) => {
      const e = eph.planets[p.id];
      return { id: p.id, pos: this._place(e.geo, F[p.id], new THREE.Vector3()), mag: e.mag, color: new THREE.Color(p.color).toArray() };
    });
    const k = P.patch ? smoothstep(0.6, 0.85, zoom) : 0;
    this.patchK = k; this.L = L;
    this.sky.u.uPatch.value.set(k, L);
    this._persp(this.sunPos, A.pos, k, L, this.sunApp);
    this._persp(this.moonPos, A.pos, k, L, this.moonApp);

    // atmosphere from the observer's point of view
    const su = this.app.skyU;
    su.uSunDir.value.copy(this.sunApp).sub(A.pos).normalize();
    su.uMoonDir.value.copy(this.moonApp).sub(A.pos).normalize();
    su.uUp.value.copy(A.up);
    this.sunDir.copy(su.uSunDir.value); this.moonDir.copy(su.uMoonDir.value);

    // the Earth disc: the Sun is a lamp over its sub-solar point, reaching L
    const ov = 1 - smoothstep(0.30, 0.60, zoom);
    this.earth.u.uLightR.value = L;
    this.earth.u.uSunH.value = this.sunPos.y;
    this.earth.u.uRingA.value = ov;

    // ground under the observer (flat, clipped at the ice wall)
    this.ground.setFrame(A.pos, A.east, A.up, A.north);
    this.ground.u.uShift.value.copy(this.app.shift);
    if (this._tintKey !== lat + ',' + lon && EARTH_TEX.day.image && EARTH_TEX.day.image.complete !== false) {
      this._tintKey = lat + ',' + lon;
      const t = sampleGroundTint(EARTH_TEX.day.image, lat, lon);
      this.ground.u.uTint.value.set(t[0] * 0.9 + 0.045, t[1] * 0.9 + 0.045, t[2] * 0.9 + 0.04);
    }
    this.ground.setAltitude(ctx.D);

    // dome + wall follow H and fade as you land
    this.dome.scale.set(R, H, R);
    this.domeU.uAlpha.value = 1 - 0.85 * smoothstep(0.35, 0.8, zoom);
    this.wallU.uAlpha.value = 1 - 0.97 * smoothstep(0.55, 0.9, zoom);       // from the ground the wall is lost in the haze
    // veil the near side of the dome while the camera is outside it
    const s = this.app.shift;
    const inside = (s.x * s.x + s.z * s.z) / (R * R) + (s.y * s.y) / (H * H);
    this.sky.u.uShellFade.value = smoothstep(0.9, 1.4, inside) * 0.9;

    // overview decoration
    const kk = 1 - smoothstep(0.34, 0.62, zoom);
    setOpacity(this.decor, kk);
    this.axis.scale.y = H;
    this.meridian.rotation.y = lonR;                                     // +x axis -> meridian direction (x = rho cos lon, z = -rho sin lon)
    this.pin.position.copy(A.pos);
    this.horizon.position.copy(A.pos);
    const ringOf = (ring, pos) => {
      const rr = Math.hypot(pos.x, pos.z);
      ring.scale.set(rr, 1, rr); ring.position.y = pos.y; ring.visible = kk > 0.004;
    };
    ringOf(this.sunRing, this.sunPos); ringOf(this.moonRing, this.moonPos);

    this.app.applyConditions(this.sky.u, this.bodies);
  }

  prepare(ctx, camera) {
    const { vh, rp } = ctx;
    const A = this.anchor;
    this.bodies.setSun(rp(this.sunApp), 0.0033, camera, vh, 3.2);
    const ov = 1 - smoothstep(0.22, 0.60, ctx.zoom);
    this.bodies.sunU.uGlow.value = 1 - 0.78 * ov;
    this.bodies.sunU.uInt.value = 1 - 0.62 * ov;
    this.bodies.setMoon(rp(this.moonApp), 0.0031, rp(this.sunApp), rp(A.pos), camera, vh, ctx.cond.moonHalo, 3.2);
    this.bodies.setPlanets(this.planetList.map((p) => ({ pos: p.pos, mag: p.mag, color: p.color })));
    this.earth.u.uTime.value = ctx.time;
    this.earth.u.uSunPos.value.copy(rp(this.sunPos));
    this.earth.mesh.visible = ctx.D > 8e-4;
  }

  // render-space (floating origin) in / out: the same perspective patch the sky shader applies
  perceive(v, obs) {
    const s = this.app.shift, p = this._pp ??= new THREE.Vector3(), o = this._po ??= new THREE.Vector3();
    p.copy(v).add(s); o.copy(obs).add(s);
    this._persp(p, o, this.patchK || 0, this.L || 1, v);
    v.sub(s);
  }

  lumRadii() { return { sun: 0.0033, moon: 0.0031 }; }            // the radii prepare() gives the lamps (21 km and 20 km)

  // The Sun and Moon as the disc predicts them (see the base class): the lamps on their domes, seen through the perspective patch.
  skyAt(jd, eph, lat, lon, out = {}) {
    const P = this.params, L = P.vanishKm / KM, gm = gmstDeg(jd) * D2R, Pinv = this._Pa ??= new THREE.Matrix4();
    Pinv.copy(eph.P).transpose();
    const latR = lat * D2R, lonR = lon * D2R, rho = Math.PI / 2 - latR;
    const A = { pos: new THREE.Vector3(rho * Math.cos(lonR), 0, -rho * Math.sin(lonR)), up: new THREE.Vector3(0, 1, 0), north: new THREE.Vector3(-Math.cos(lonR), 0, Math.sin(lonR)), east: new THREE.Vector3(-Math.sin(lonR), 0, -Math.cos(lonR)) };
    for (const [key, v, f] of [['sun', eph.sun, F.sun], ['moon', eph.moon, F.moon]]) {
      const raw = this._place(v, f, new THREE.Vector3(), Pinv, gm), dist = raw.distanceTo(A.pos);
      const seen = this._persp(raw, A.pos, P.patch ? 1 : 0, L, new THREE.Vector3());
      const h = dirToHoriz(seen.sub(A.pos), A);
      out[key] = { alt: h.alt, az: h.az, dist };
    }
    return out;
  }

  // what the observer is predicted to see for an object at model position `pos`
  horizontal(pos) {
    const v = this._persp(pos, this.anchor.pos, this.params.patch ? 1 : 0, this.params.vanishKm / KM, new THREE.Vector3());
    return dirToHoriz(v.sub(this.anchor.pos), this.anchor);
  }

  objectPosition(key) {
    if (key === 'sun') return this.sunPos.clone();
    if (key === 'moon') return this.moonPos.clone();
    const pl = this.planetList?.find((p) => p.id === key);
    if (pl) return pl.pos.clone();
    const radec = { polaris: [37.9545, 89.2641], galcentre: [266.4168, -29.0078] }[key];
    if (!radec) return null;
    const rho = Math.PI / 2 - radec[1] * D2R, a = radec[0] * D2R - this._gm;
    return new THREE.Vector3(rho * Math.cos(a), this.params.domeH * Math.sqrt(Math.max(0, 1 - (rho / R) ** 2)), -rho * Math.sin(a));
  }

  labelItems() {
    const A = this.anchor, out = [];
    for (const [t, dir] of [['北', A.north], ['东', A.east], ['南', A.north.clone().negate()], ['西', A.east.clone().negate()]]) {
      out.push({ kind: 'cardinal', text: t, pos: A.pos.clone().addScaledVector(dir, 0.3), model: true });
    }
    out.push({ kind: 'model', text: '北极 · 圆盘中心', pos: new THREE.Vector3(0, 0.02, 0) });
    out.push({ kind: 'model', text: '冰墙', pos: new THREE.Vector3(R, 0.04, 0) });
    return out;
  }
}
