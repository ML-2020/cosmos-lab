// 巨球论 - the two-sphere universe (浑天说): the Earth is a giant sphere at the centre; the heavens are a
// second, vastly larger sphere that turns once a day about the celestial pole.  The Sun, Moon and the five
// wanderers ride the ecliptic belt of that sphere on their own shells.  Seen from the ground the sky is
// exactly the real one: the Pole Star stands as high above the horizon as your latitude.
import * as THREE from 'three';
import { Cosmology, Y_AXIS, ringLine, polyLine, setOpacity, lerpLog } from './base.js';
import { SkyLayer } from '../sky.js';
import { EarthGlobe, EARTH_TEX } from '../earth.js';
import { Bodies } from '../bodies.js';
import { Ground, sampleGroundTint } from '../ground.js';
import { smoothstep } from '../util.js';
import { glowTexture } from '../util.js';
import { eqToVec, localFrame, gmstDeg, dirToHoriz, D2R, PLANETS, SUN_RADIUS_KM, MOON_RADIUS_KM, R_EARTH_KM } from '../astro.js';
import { POLARIS_INDEX } from '../data.js';

const SHELL = { sky: 9, sun: 5.2, moon: 2.7, mercury: 3.6, venus: 4.2, mars: 6.0, jupiter: 6.8, saturn: 7.6 };

export class GlobeModel extends Cosmology {
  constructor(app) {
    super(app, { id: 'globe', zh: '巨球论', en: 'Giant Sphere', accent: '#35e0c8', tag: '浑天 · 两球宇宙' });
    this._f = {};
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this.journey = {
      knots: [[0, 28], [0.14, 12], [0.30, 3.4], [0.50, 0.30], [0.68, 0.016], [0.84, 1.6e-4], [1, 1.7 / 6.371e6]],
      target: (o) => o.set(0, 0, 0), overviewUp: new THREE.Vector3(0, 1, 0),
      targetZ: [0.12, 0.42], dirZ: [0.40, 0.82], fpZ: [0.80, 0.97],
    };
    this.overviewDefault = { yaw: 0.55, pitch: 0.38 };
    this.guides = true;                       // equator + ecliptic rings on the shell in the palm view
  }

  // fraction [0..1] of "true scale": 0 = armillary display, 1 = real distances
  trueBlend(D) { return 1 - smoothstep(Math.log(0.25), Math.log(9), Math.log(D)); }

  build() {
    const skyU = this.app.skyU;
    this.earth = new EarthGlobe();
    this.sky = new SkyLayer({ place: (ra, dec, out) => eqToVec(ra, dec, 1000, out) });
    this.bodies = new Bodies(this.sky.u);
    this.ground = new Ground({ curvature: 1, capMax: 0.45, shared: skyU });
    this.group.add(this.earth.group, this.sky.group, this.bodies.group, this.ground.group);

    // ---- overview decoration: axis, equator, meridian, observer pin, horizon plane
    const d = this.decor = new THREE.Group();
    const cyan = 0x59f0da, gold = 0xffc23d;
    d.add(polyLine([new THREE.Vector3(0, -SHELL.sky - 0.9, 0), new THREE.Vector3(0, SHELL.sky + 0.9, 0)], cyan, 0.34));
    this.equator = ringLine(1.006, cyan, 0.65);
    this.meridian = ringLine(1.008, 0xbfd2ff, 0.28, 256, 'xy');
    d.add(this.equator, this.meridian);

    this.pin = new THREE.Group();
    this.pin.add(polyLine([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2.1, 0)], gold, 0.9));
    const tip = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2.1, 0)]),
      new THREE.PointsMaterial({ color: gold, size: 22, sizeAttenuation: false, map: glowTexture(128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const base = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.0, 0)]),
      new THREE.PointsMaterial({ color: gold, size: 10, sizeAttenuation: false, map: glowTexture(64), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pin.add(tip, base);
    this.horizon = new THREE.Group();
    this.horizon.add(ringLine(1.5, 0xffc23d, 0.55));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }));
    this.horizon.add(disc);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this.horizon.add(polyLine([new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5), new THREE.Vector3(Math.cos(a) * 1.72, 0, Math.sin(a) * 1.72)], 0xffc23d, 0.9));
    }
    d.add(this.pin, this.horizon);
    this.group.add(d);
    this.built = true;
  }

  // inertial (equator of date) vector -> Earth-fixed scene position at radius R
  _ef(v, R, out) {
    return out.copy(v).normalize().applyAxisAngle(Y_AXIS, -this._gm).multiplyScalar(R);
  }

  step(ctx) {
    const { eph, jd, lat, lon, g, zoom } = ctx;
    this._gm = gmstDeg(jd) * D2R;
    const gm = this._gm;
    this.sky.group.rotation.y = -gm;
    const shellR = lerpLog(SHELL.sky, 1000, g);
    this.sky.group.scale.setScalar(shellR / 1000);
    // veil the near hemisphere of the shell while the camera is outside it
    this.sky.u.uShellFade.value = smoothstep(0.95, 1.5, ctx.D / shellR);
    this.sky.j2000.matrix.copy(eph.P);

    const f = localFrame(lat, lon, this._f);
    const A = this.anchor;
    A.up.copy(f.up); A.north.copy(f.north); A.east.copy(f.east); A.pos.copy(f.up);

    // luminaries on their shells (display) -> true geocentric distances (g = 1)
    const kmR = (km) => km / R_EARTH_KM;
    this._ef(eph.sun, lerpLog(SHELL.sun, eph.sun.length(), g), this.sunPos);
    this._ef(eph.moon, lerpLog(SHELL.moon, eph.moon.length(), g), this.moonPos);
    this.earth.setSun(this._a.copy(this.sunPos).normalize());
    this.planetList = PLANETS.map((p) => {
      const e = eph.planets[p.id];
      return { id: p.id, pos: this._ef(e.geo, lerpLog(SHELL[p.id], e.geo.length(), g), new THREE.Vector3()), mag: e.mag, color: new THREE.Color(p.color).toArray() };
    });

    // atmosphere uniforms (from the observer)
    const su = this.app.skyU;
    su.uSunDir.value.copy(this.sunPos).sub(A.pos).normalize();
    su.uMoonDir.value.copy(this.moonPos).sub(A.pos).normalize();
    su.uUp.value.copy(A.up);
    this.sunDir.copy(su.uSunDir.value); this.moonDir.copy(su.uMoonDir.value);

    // ground
    this.ground.setFrame(A.pos, A.east, A.up, A.north);
    if (this._tintKey !== lat + ',' + lon && EARTH_TEX.day.image && EARTH_TEX.day.image.complete !== false) {
      this._tintKey = lat + ',' + lon;
      const t = sampleGroundTint(EARTH_TEX.day.image, lat, lon);
      this.ground.u.uTint.value.set(t[0] * 0.9 + 0.045, t[1] * 0.9 + 0.045, t[2] * 0.9 + 0.04);
    }
    this.ground.setAltitude(Math.max(0, ctx.D * (ctx.zoom > 0.9 ? 1 : 1)) * 1.0);

    // overview decor
    const k = 1 - smoothstep(0.34, 0.60, zoom);
    setOpacity(this.decor, k);
    this.meridian.rotation.y = lon * D2R;
    this.pin.quaternion.setFromUnitVectors(Y_AXIS, A.up);
    this.horizon.position.copy(A.pos);
    this.horizon.quaternion.setFromUnitVectors(Y_AXIS, A.up);
    // align the horizon's tick marks with north: rotate about up so +x -> east
    const q2 = new THREE.Quaternion().setFromAxisAngle(A.up, 0);
    const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.horizon.quaternion);
    const ang = Math.atan2(new THREE.Vector3().crossVectors(xAxis, A.east).dot(A.up), xAxis.dot(A.east));
    this.horizon.quaternion.premultiply(q2.setFromAxisAngle(A.up, ang));

    // sky layer cosmetics follow the shared conditions
    this.app.applyConditions(this.sky.u, this.bodies);
  }

  prepare(ctx, camera) {
    const { g, vh, rp } = ctx;
    const rs = lerpLog(0.38, SUN_RADIUS_KM / R_EARTH_KM, g);
    this.bodies.setSun(rp(this.sunPos), rs, camera, vh, 3.2);
    const ov = 1 - smoothstep(0.22, 0.60, ctx.zoom);                 // compact sun while the model rests in the palm
    this.bodies.sunU.uGlow.value = 1 - 0.78 * ov;
    this.bodies.sunU.uInt.value = 1 - 0.62 * ov;
    const rm = lerpLog(0.16, MOON_RADIUS_KM / R_EARTH_KM, g);
    this.bodies.setMoon(rp(this.moonPos), rm, rp(this.sunPos), rp(this._c.set(0, 0, 0)), camera, vh, ctx.cond.moonHalo, 3.2);
    // planets are Points under the floating-origin group, so they take model coordinates (the group applies -shift)
    this.bodies.setPlanets(this.planetList.map((p) => ({ pos: p.pos, mag: p.mag, color: p.color })));
    this.earth.u.uTime.value = ctx.time;
    this.earth.u.uPxAng.value = this.ground.u.uPxAng.value = 2 * Math.tan(camera.fov * Math.PI / 360) / vh;
    // the ground cap and the sky dome take over when the camera is near the surface; the limb halo must not wrap the observer
    this.earth.haloU.uAlpha.value = smoothstep(0.03, 0.12, ctx.D);
    this.earth.halo.visible = ctx.D > 0.03;
    this.earth.mesh.visible = ctx.D > 8e-4;
  }

  objectPosition(key) {
    const eph = this.app.eph;
    if (key === 'polaris') return this._ef(eqToVec(37.9545, 89.2641, 1, new THREE.Vector3()).applyMatrix4(eph.P), 1e6, new THREE.Vector3());
    if (key === 'galcentre') return this._ef(eqToVec(266.4168, -29.0078, 1, new THREE.Vector3()).applyMatrix4(eph.P), 1e6, new THREE.Vector3());
    if (key === 'sun') return this.sunPos.clone();
    if (key === 'moon') return this.moonPos.clone();
    const pl = this.planetList?.find((p) => p.id === key);
    return pl ? pl.pos.clone() : null;
  }

  // True geocentric geometry: the model's sky is the real one (what differs is the picture of the world behind it).
  predictions() {
    const eph = this.app.eph, A = this.anchor, out = [];
    const item = (key, v) => out.push({ key, model: dirToHoriz(this._ef(v, v.length(), this._b).sub(A.pos), A) });
    item('sun', eph.sun); item('moon', eph.moon);
    for (const p of PLANETS) item(p.id, eph.planets[p.id].geo);
    return out;
  }

  labelItems() {
    const A = this.anchor, out = [];
    for (const [t, dir] of [['北', A.north], ['东', A.east], ['南', A.north.clone().negate()], ['西', A.east.clone().negate()]]) {
      out.push({ kind: 'cardinal', text: t, pos: A.pos.clone().addScaledVector(dir, 1.62), model: true });
    }
    return out;
  }
}
