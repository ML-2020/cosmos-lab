// The machinery of the Ptolemaic heavens, as pure maths (no rendering).
//
// Everything is computed in the ecliptic frame of J2000 (x = equinox, y = 90 deg east, z = north ecliptic pole) with the
// Earth fixed at the origin.  Lengths are in "deferent units": 1 = the radius of the body's own deferent.
//
//   Sun       an eccentric circle: the Sun runs uniformly about a point offset from the Earth toward the apogee.
//   Moon      Ptolemy's second model: an epicycle on an eccentric deferent whose centre revolves about the Earth
//             opposite to the mean elongation (the "crank"), giving the equation of centre and the evection.
//   Mars, Jupiter, Saturn
//             an eccentric deferent carrying an epicycle, the epicentre moving uniformly as seen from the EQUANT
//             (a point twice as far from the Earth as the deferent's centre, on the apogee side); the epicycle's
//             radius vector always points the way the Sun does.
//   Venus, Mercury
//             the epicentre rides the Sun's line; the planet circles the epicentre on an eccentric epicycle with
//             its own equant (a modest simplification of the Almagest's apsidal mechanisms for the two inferiors).
//
// Parameters keep the Almagest's *structure* and its ratios (epicycle/deferent, eccentricity/deferent) but are
// calibrated to modern mean motions and apsides, so the machine predicts as well as such circles can.  Where the
// circles cannot match the real sky (a few tenths of a degree up to ~1-2 degrees) that error is the model's own.
import * as THREE from 'three';
import { D2R, mod, ELEMENTS, centuries, sunMeanLon, perihelionLon } from '../astro.js';

const TAU = Math.PI * 2;
const U = (a) => [Math.cos(a), Math.sin(a)];

// ---- true (Planetary Hypotheses) deferent radii in Earth radii; the shells nest: Moon < Mercury < Venus < Sun < Mars < ...
export const RT = { moon: 48.8, mercury: 115, venus: 624, sun: 1210, mars: 5040, jupiter: 11504, saturn: 17026 };
export const STARS_RT = 20000;

const el = (id) => ELEMENTS[id];
const ecc = (id, T) => el(id)[2] + el(id)[3] * T;
const sma = (id, T) => el(id)[0] + el(id)[1] * T;
const inc = (id, T) => (el(id)[4] + el(id)[5] * T) * D2R;
const node = (id, T) => (el(id)[10] + el(id)[11] * T) * D2R;
const lonMean = (id, T) => (el(id)[6] + el(id)[7] * T) * D2R;
const lonPeri = (id, T) => (el(id)[8] + el(id)[9] * T) * D2R;

// plane (x along the node, y 90 deg ahead in the plane) -> ecliptic xyz
function lift(x, y, Om, I, out) {
  const cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return out.set(x * cO - y * sO * cI, x * sO + y * cO * cI, y * sI);
}

// Eccentric circle (radius R) with equant, in an orbital plane.  Angles are measured from the node.
//   thA: direction of the apogee from the point where the Sun/Earth sits (origin);  th: mean angle seen from the equant
// Returns planar {C, Q, D} as [x, y] with R = 1 times `R`.
function eccentricEquant(thA, th, e, R) {
  const [ax, ay] = U(thA), [ux, uy] = U(th);
  const C = [e * R * ax, e * R * ay], Q = [2 * e * R * ax, 2 * e * R * ay];
  const wx = Q[0] - C[0], wy = Q[1] - C[1];
  const wu = wx * ux + wy * uy, ww = wx * wx + wy * wy;
  const t = -wu + Math.sqrt(Math.max(0, wu * wu - ww + R * R));
  return { C, Q, D: [Q[0] + t * ux, Q[1] + t * uy] };
}

export class PtolemaicSystem {
  constructor(opts = {}) {
    this.opts = { sunEpicycle: 'true', moonAnomalyRef: 'earth', ...opts };
    this.t = {};                          // scratch result, reused
  }

  // ---------------------------------------------------------------- the Sun
  // returns { C, S, e, apogee } in AU (R = 1 AU).
  sun(jd, o = {}) {
    const T = centuries(jd);
    const e = 2 * ecc('earth', T);                       // an eccentric circle needs twice the real eccentricity
    const thA = lonPeri('earth', T);                     // apogee of the Sun's circle
    const lam = sunMeanLon(jd) * D2R;
    const C = new THREE.Vector3(e * Math.cos(thA), e * Math.sin(thA), 0);
    const S = new THREE.Vector3(C.x + Math.cos(lam), C.y + Math.sin(lam), 0);
    o.C = C; o.S = S; o.e = e; o.apogee = thA; o.meanLon = lam;
    o.env = { min: 1 - e, max: 1 + e };
    return o;
  }

  // ---------------------------------------------------------------- a planet
  // returns the gear: { kind, centre: epicentre or equivalent (AU), planet (AU), deferent:{C,R,plane}, equant, epi:{centre,R} ... }
  planet(id, jd, o = {}) {
    const T = centuries(jd);
    const sunG = this.sun(jd, {});
    const a = sma(id, T), e = ecc(id, T), Om = node(id, T), I = inc(id, T);
    const varpi = lonPeri(id, T), L = lonMean(id, T);
    const thA = varpi + Math.PI - Om, th = L - Om;
    o.id = id;
    if (id === 'mars' || id === 'jupiter' || id === 'saturn') {
      const R = a;                                      // deferent radius = a (AU); epicycle radius = a_earth
      const r = sma('earth', T);
      const q = eccentricEquant(thA, th, e, R);
      const C = lift(q.C[0], q.C[1], Om, I, new THREE.Vector3());
      const Q = lift(q.Q[0], q.Q[1], Om, I, new THREE.Vector3());
      const D = lift(q.D[0], q.D[1], Om, I, new THREE.Vector3());
      let dir;
      if (this.opts.sunEpicycle === 'mean') dir = new THREE.Vector3(Math.cos(sunG.meanLon), Math.sin(sunG.meanLon), 0);
      else dir = sunG.S.clone().normalize();
      const ep = dir.multiplyScalar(r);
      o.kind = 'superior';
      o.deferent = { C, R, Om, I, apogee: thA + Om };
      o.equant = Q; o.epiCentre = D; o.epiR = r; o.epiVec = ep;
      o.planet = D.clone().add(ep);
      o.scaleRef = R;                                    // 1 deferent unit in AU
      o.plane = { Om, I };
      o.env = { min: R * (1 - e) - r, max: R * (1 + e) + r };
    } else {                                            // venus, mercury
      // epicentre on the Sun's line at the Sun's deferent distance; the planet on an eccentric epicycle with equant
      const R = a;                                       // epicycle radius = a_p (AU) in units where the Sun deferent = 1 AU
      const q = eccentricEquant(thA, th, e, R);
      const C = lift(q.C[0], q.C[1], Om, I, new THREE.Vector3());
      const Q = lift(q.Q[0], q.Q[1], Om, I, new THREE.Vector3());
      const P = lift(q.D[0], q.D[1], Om, I, new THREE.Vector3());
      const D = sunG.S.clone();                           // the epicentre is the Sun's position
      o.kind = 'inferior';
      o.deferent = { C: sunG.C.clone(), R: 1, Om: 0, I: 0, apogee: sunG.apogee };
      o.epiCentre = D; o.epiR = R; o.epiEcc = C; o.equant = Q.add(D);
      o.epiCentreOffset = C.clone().add(D);               // centre of the epicycle circle itself (eccentric epicycle)
      o.epiVec = P;
      o.planet = D.clone().add(P);
      o.scaleRef = 1;
      o.plane = { Om, I };
      o.env = { min: Math.max(0.02, 1 - sunG.e - R * (1 + e)), max: 1 + sunG.e + R * (1 + e) };
    }
    return o;
  }

  // ---------------------------------------------------------------- the Moon
  // returns { epiCentre, moon, C (deferent centre), R, r, e } in deferent units (R = 1)
  moon(jd, o = {}) {
    const T = centuries(jd);
    const prec = 1.396888 * T;                            // general precession in longitude, deg (of-date -> J2000)
    const Lm = (218.3164477 + 481267.88123421 * T - 0.0015786 * T * T - prec) * D2R;
    const Mm = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * D2R;
    const Om = (125.0445479 - 1934.1362891 * T + 0.0020754 * T * T - prec) * D2R;
    const I = 5.1453964 * D2R;
    const lamS = sunMeanLon(jd) * D2R;
    // Almagest V: deferent 49;41, eccentricity 10;19 (so the epicentre is never farther than 60), epicycle 5;15
    const R = 1, e = this.opts.moonE ?? 10.3167 / 49.6833, r = this.opts.moonR ?? 5.25 / 49.6833;
    const th = Lm - Om, thS = lamS - Om;
    const psi = 2 * thS - th;                             // the deferent's centre revolves opposite to the elongation
    const [ux, uy] = U(th);
    const Cx = e * Math.cos(psi), Cy = e * Math.sin(psi);
    const cu = Cx * ux + Cy * uy, cc = Cx * Cx + Cy * Cy;
    const t = cu + Math.sqrt(Math.max(0, cu * cu - cc + R * R));
    const Dx = t * ux, Dy = t * uy;
    // anomaly measured from the epicycle's mean apogee
    let refx, refy;
    if (this.opts.moonAnomalyRef === 'earth') { refx = Dx; refy = Dy; }
    else { refx = Dx - 2 * Cx; refy = Dy - 2 * Cy; }
    const ref = Math.atan2(refy, refx);
    const al = Mm + Math.PI;
    // the Moon circles its epicycle clockwise (backward at the top, forward at the bottom): slowest at apogee, fastest near us
    const px = Dx + r * Math.cos(ref - al), py = Dy + r * Math.sin(ref - al);
    o.C = lift(Cx, Cy, Om, I, new THREE.Vector3());
    o.epiCentre = lift(Dx, Dy, Om, I, new THREE.Vector3());
    o.moon = lift(px, py, Om, I, new THREE.Vector3());
    o.R = R; o.r = r; o.e = e; o.scaleRef = 1;
    o.plane = { Om, I };
    o.env = { min: 1 - e - r, max: 1 + e + r };
    return o;
  }
}

// angular separation between two vectors (degrees)
export const sepDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))) * 180 / Math.PI;
