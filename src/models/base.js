// Base class + helpers for a cosmology (a "hypothesis": a geometry for the heavens).
//
// Every cosmology owns: a group of overview geometry, a SkyLayer (real stars placed by ITS geometry),
// luminaries (Sun, Moon, planets placed by ITS mechanism), a ground under the observer, and the
// camera journey that carries you from the model in your palm to the observer's feet.
//
// Coordinates: "model coordinates", 1 unit = 1 Earth radius.  The App renders with a floating origin
// (the observer), so anything that bypasses the scene graph (shader uniforms holding positions,
// billboard centres) must subtract ctx.shift - use ctx.rp(v).
import * as THREE from 'three';
import { D2R, dirToHoriz, horizToDir, R_EARTH_KM, SUN_RADIUS_KM, MOON_RADIUS_KM, gmstDeg, localFrame } from '../astro.js';

export { lerpLog } from '../util.js';

export const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function ringLine(radius, color, opacity = 0.5, segments = 256, plane = 'xz') {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2, c = Math.cos(a) * radius, s = Math.sin(a) * radius;
    pts.push(plane === 'xz' ? new THREE.Vector3(c, 0, s) : plane === 'xy' ? new THREE.Vector3(c, s, 0) : new THREE.Vector3(0, c, s));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

export function polyLine(points, color, opacity = 0.5) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

// Fades every LineBasicMaterial/Points material below `root` to base * k.
export function setOpacity(root, k) {
  root.traverse((o) => {
    const m = o.material; if (!m) return;
    if (o.userData.baseOpacity === undefined) o.userData.baseOpacity = m.opacity ?? 1;
    m.opacity = o.userData.baseOpacity * k;
  });
  root.visible = k > 0.004;
}

export class Cosmology {
  constructor(app, meta) {
    this.app = app;
    Object.assign(this, meta);               // id, zh, en, accent, tag, ...
    this.group = new THREE.Group(); this.group.name = `cosmos-${meta.id}`;
    this.anchor = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), north: new THREE.Vector3(0, 0, -1), east: new THREE.Vector3(1, 0, 0) };
    this.built = false;
    this.sunPos = new THREE.Vector3(); this.moonPos = new THREE.Vector3();   // model coords (displayed)
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3();   // from the observer, unit
  }

  build() { this.built = true; }                       // heavy construction, lazily
  step(ctx) {}                                         // advance state, fill this.anchor / sun/moon
  prepare(ctx, camera) {}                              // billboards, label anchors (needs the camera)
  setActive(on) { this.group.visible = on; }

  // model-predicted horizontal coordinates of an object given its model-coordinates position
  horizontal(pos) { return dirToHoriz(pos.clone().sub(this.anchor.pos), this.anchor); }
  lookDir(az, alt, out) { return horizToDir(az, alt, this.anchor, out); }

  // Where this cosmology draws a place on (or above) the Earth: `u` = Earth-fixed unit vector (scene: +Y pole, lon 0 on +X).
  // Sphere models put it on a sphere; the flat model overrides these with the disc.  The result is in the Earth's own frame
  // (a child of `earth.group` draws it in the right place whatever the Earth is doing).
  earthPoint(u, hKm, out) { return out.copy(u).multiplyScalar(1 + hKm / R_EARTH_KM); }
  // a path between two Earth-fixed unit vectors as this cosmology draws it (great circle on a sphere, straight line on the disc)
  earthPath(u0, u1, n, hKm, out = []) {
    const d = Math.acos(Math.max(-1, Math.min(1, u0.dot(u1))));
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = Math.sin(d) < 1e-6 ? 0 : 1 / Math.sin(d);
      const a = s ? Math.sin((1 - t) * d) * s : 1 - t, b = s ? Math.sin(t * d) * s : t;
      out[i] = (out[i] || new THREE.Vector3()).copy(u0).multiplyScalar(a).addScaledVector(u1, b).normalize().multiplyScalar(1 + hKm / R_EARTH_KM);
    }
    return out;
  }

  // Physical radius (Earth radii) this cosmology gives the Sun and the Moon: with the distance it sets how big they look.
  lumRadii() { return { sun: SUN_RADIUS_KM / R_EARTH_KM, moon: MOON_RADIUS_KM / R_EARTH_KM }; }

  // The Sun and the Moon as this cosmology predicts them for an observer at (lat, lon) at time jd, from the ground:
  //   { sun: {alt, az, dist}, moon: {alt, az, dist} }   degrees, and distance from the observer in Earth radii.
  // `eph` is an Ephemeris already updated to jd.  This default is the one every sphere that keeps the true geocentric geometry
  // gives (巨球论, 日心说, and the real sky itself): the Sun and Moon on a rotating Earth.  地平说 and 地心说 override it.
  skyAt(jd, eph, lat, lon, out = {}) {
    const gm = gmstDeg(jd) * D2R, f = localFrame(lat, lon, this._sf ??= {}), obs = f.up;
    for (const [key, v] of [['sun', eph.sun], ['moon', eph.moon]]) {
      const p = this._sv ??= new THREE.Vector3();
      p.copy(v).applyAxisAngle(Y_AXIS, -gm).sub(obs);
      const h = dirToHoriz(p, f);
      out[key] = { alt: h.alt, az: h.az, dist: p.length() };
    }
    return out;
  }

  // objects the comparison card can ask about: key -> position in model coords (or null)
  objectPosition(key) { return null; }
  labelItems() { return []; }
}
