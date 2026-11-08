// The scale journey: one continuous parameter z in [0, 1] carries the camera from
// "the whole model resting in your palm" (z = 0) to "a tiny person standing on the ground
// looking up" (z = 1).  Distances are interpolated in log space along per-model knots, so every
// step of the slider is the same factor of scale, whether it crosses 10 AU or 10 metres.
import * as THREE from 'three';
import { clamp, smoothstep, lerp } from './util.js';
import { horizToDir } from './astro.js';

export const EYE = 1.7 / 6.371e6;            // eye height in Earth radii

// Monotone cubic (Fritsch-Carlson) interpolation of y(x) through the knots.
export function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export function makeDistanceCurve(knots) {
  const f = monotone(knots.map((k) => k[0]), knots.map((k) => Math.log(k[1])));
  return (z) => Math.exp(f(clamp(z, 0, 1)));
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3();
const _fw = new THREE.Vector3(), _o = new THREE.Vector3(), _cd = new THREE.Vector3(), _lh = new THREE.Vector3(), _hint = new THREE.Vector3(), _yy = new THREE.Vector3(0, 1, 0);

export function slerpDir(a, b, t, out) {
  const d = clamp(a.dot(b), -1, 1), om = Math.acos(d);
  if (om < 1e-5) return out.copy(b);
  const s = Math.sin(om);
  return out.copy(a).multiplyScalar(Math.sin((1 - t) * om) / s).addScaledVector(b, Math.sin(t * om) / s).normalize();
}

// Overview direction from orbit angles (yaw about +Y, pitch above the model's equator plane).
export function orbitDir(yaw, pitch, upAxis, out) {
  const cp = Math.cos(pitch);
  out.set(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw));
  if (upAxis && (upAxis.x || upAxis.z)) {
    // rotate +Y onto upAxis
    _q1.setFromUnitVectors(_u.set(0, 1, 0), upAxis);
    out.applyQuaternion(_q1);
  }
  return out;
}

/**
 * Computes the camera pose for slider value z.
 *   model.journey : { knots:[[z, distance]...], target(out), overviewUp: Vector3, targetZ:[z0,z1], dirZ:[z0,z1], fpZ:[z0,z1] }
 *   anchor        : { pos, up, north, east }   (model coords)
 *   view          : { yaw, pitch, az, alt, fov, fovFP }
 * Returns { position, quaternion, fov, distance } with position in model coords.
 */
export function journeyPose(model, curve, z, anchor, view, out = {}) {
  const J = model.journey;
  const D = curve(z);
  out.distance = D;
  const T0 = J.target(_t.set(0, 0, 0));
  const wT = smoothstep(J.targetZ[0], J.targetZ[1], z);
  const T = (out.target = out.target || new THREE.Vector3()).copy(T0).lerp(anchor.pos, wT);

  // direction from target to camera: user's orbit direction -> zenith
  const dUser = orbitDir(view.yaw, view.pitch, J.overviewUp, _dir).clone();
  const dir = slerpDir(dUser, anchor.up, smoothstep(J.dirZ[0], J.dirZ[1], z), _cd);
  // Once the camera orbits the observer's own spot it must stay above the local horizon plane,
  // otherwise a user orbit pointing "through" the ground would put the camera inside the Earth.
  const elMin = (J.minElevation ?? 0.14) * smoothstep(0.26, 0.40, z);
  const el = dir.dot(anchor.up);
  if (el < elMin) {
    _u.copy(dir).addScaledVector(anchor.up, -el);
    if (_u.lengthSq() < 1e-8) _u.copy(anchor.north);
    _u.normalize().multiplyScalar(Math.sqrt(1 - elMin * elMin));
    dir.copy(_u).addScaledVector(anchor.up, elMin);
  }
  const pos = (out.position = out.position || new THREE.Vector3()).copy(T).addScaledVector(dir, D);

  // orientation: look at the target.  Screen-up is the model axis in the overview; near the ground it is the
  // local vertical, and straight above the observer it is the heading the person will face (so the final
  // pitch-up to the horizon never rolls the picture).
  const head = horizToDir(view.az, 0, anchor, _fw);
  const wDown = smoothstep(0.55, 0.92, dir.dot(anchor.up));
  _lh.copy(anchor.up).lerp(head, wDown).normalize();
  const upHint = _hint.copy(J.overviewUp || _yy).lerp(_lh, smoothstep(0.26, 0.45, z)).normalize();
  _m.lookAt(pos, T, upHint);
  _q1.setFromRotationMatrix(_m);
  // ... then stand up and look at the sky
  const fw = horizToDir(view.az, view.alt, anchor, _fw);
  _m.lookAt(_o, fw, anchor.up);
  _q2.setFromRotationMatrix(_m);
  const s = smoothstep(J.fpZ[0], J.fpZ[1], z);
  out.quaternion = (out.quaternion || new THREE.Quaternion()).copy(_q1).slerp(_q2, s);
  out.fov = lerp(view.fovOverview || 40, view.fov, smoothstep(0.08, 0.62, z));
  out.land = s;
  return out;
}
