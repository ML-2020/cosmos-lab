// Real astronomy shared by every cosmology.
//
// Scene convention (right-handed, Y up), 1 unit = 1 Earth radius:
//   +Y = north celestial pole, +X = vernal equinox (RA 0h), RA grows from +X toward -Z.
//   eqToVec(ra, dec) = (cos d cos a,  sin d,  -cos d sin a)
// The inertial scene frame is the TRUE EQUATOR OF DATE: star catalogues (J2000) are rotated into it
// by Ephemeris.P / precessionMatrix(jd); the Earth-fixed frame is the inertial frame turned by -GMST
// about Y.  "Reality" (Sun, Moon, planets, phases, magnitudes) comes from astronomy-engine.
import * as THREE from 'three';
import * as A from 'astronomy-engine';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const AU_KM = 149597870.7;
export const R_EARTH_KM = 6371.0;
export const AU_R = AU_KM / R_EARTH_KM;            // one astronomical unit in Earth radii
export const SUN_RADIUS_KM = 695700;
export const MOON_RADIUS_KM = 1737.4;
export const OBLIQUITY = 23.43928 * D2R;           // J2000 mean obliquity

export const mod = (x, m) => ((x % m) + m) % m;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ------------------------------------------------------------------ vectors
export function eqToVec(raDeg, decDeg, r = 1, out = new THREE.Vector3()) {
  const a = raDeg * D2R, d = decDeg * D2R, c = Math.cos(d);
  return out.set(r * c * Math.cos(a), r * Math.sin(d), -r * c * Math.sin(a));
}
export function vecToEq(v) {
  const r = v.length();
  return { ra: mod(Math.atan2(-v.z, v.x) * R2D, 360), dec: Math.asin(clamp(v.y / r, -1, 1)) * R2D, r };
}
// astronomy-engine "standard" axes (x equinox, y 90E, z pole) -> scene axes
export const stdToScene = (x, y, z, out = new THREE.Vector3()) => out.set(x, z, -y);
// ecliptic J2000 cartesian -> equatorial J2000 in scene axes
export const eclToScene = (x, y, z, out = new THREE.Vector3()) => {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return stdToScene(x, y * c - z * s, y * s + z * c, out);
};

// ---------------------------------------------------------------------- time
export const J2000 = 2451545.0;
export const jdFromDate = (d) => d.getTime() / 86400000 + 2440587.5;
export const dateFromJd = (jd) => new Date((jd - 2440587.5) * 86400000);
export const centuries = (jd) => (jd - J2000) / 36525;

export function gmstDeg(jd) {
  const T = centuries(jd);
  return mod(280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T, 360);
}
export const lstDeg = (jd, lonDeg) => mod(gmstDeg(jd) + lonDeg, 360);

// ----------------------------------------------- precession (J2000 -> of date)
let pJd = NaN, pTime = null, pRot = null;
function pFrame(jd) {
  if (jd === pJd) return;
  pJd = jd; pTime = A.MakeTime(dateFromJd(jd)); pRot = A.Rotation_EQJ_EQD(pTime);
}
const _S = new THREE.Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0);   // std -> scene
const _St = _S.clone().transpose();
// J2000 equatorial (scene axes) -> true equator of date (scene axes) as a Matrix4.
export function precessionMatrix(jd, out = new THREE.Matrix4()) {
  pFrame(jd);
  const c = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([x, y, z]) => A.RotateVector(pRot, new A.Vector(x, y, z, pTime)));
  const R = new THREE.Matrix3().set(c[0].x, c[1].x, c[2].x, c[0].y, c[1].y, c[2].y, c[0].z, c[1].z, c[2].z);
  const e = _S.clone().multiply(R).multiply(_St).elements;           // column-major
  return out.set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1);
}
export function astroTime(jd) { pFrame(jd); return pTime; }

// -------------------------------------------------------- observer frames
// {up, north, east} = zenith and tangents, right-handed (east x north = up).  `lonOrLst` is a geographic
// longitude for the Earth-fixed frame, or a local sidereal time for the inertial frame.
export function localFrame(latDeg, lonOrLstDeg, out = {}) {
  out.up ??= new THREE.Vector3(); out.north ??= new THREE.Vector3(); out.east ??= new THREE.Vector3();
  const f = latDeg * D2R, l = lonOrLstDeg * D2R;
  const sf = Math.sin(f), cf = Math.cos(f), sl = Math.sin(l), cl = Math.cos(l);
  out.up.set(cf * cl, sf, -cf * sl);
  out.north.set(-sf * cl, cf, sf * sl);
  out.east.set(-sl, 0, -cl);
  return out;
}
// Direction for azimuth (from north through east) and altitude (degrees) in the frame.
export function horizToDir(azDeg, altDeg, fr, out = new THREE.Vector3()) {
  const a = azDeg * D2R, h = altDeg * D2R, ch = Math.cos(h);
  return out.set(0, 0, 0)
    .addScaledVector(fr.east, ch * Math.sin(a))
    .addScaledVector(fr.north, ch * Math.cos(a))
    .addScaledVector(fr.up, Math.sin(h));
}
export function dirToHoriz(dir, fr) {
  const n = dir.clone().normalize();
  return { alt: Math.asin(clamp(n.dot(fr.up), -1, 1)) * R2D, az: mod(Math.atan2(n.dot(fr.east), n.dot(fr.north)) * R2D, 360) };
}
// Horizontal coordinates for a position given in equator-of-date RA/Dec (degrees).
export function altAz(raDeg, decDeg, lstDegV, latDeg) {
  const H = (lstDegV - raDeg) * D2R, d = decDeg * D2R, f = latDeg * D2R;
  const alt = Math.asin(clamp(Math.sin(d) * Math.sin(f) + Math.cos(d) * Math.cos(f) * Math.cos(H), -1, 1));
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(f) - Math.cos(d) * Math.sin(f) * Math.cos(H));
  return { alt: alt * R2D, az: mod(az * R2D, 360) };
}
// Saemundsson refraction (degrees) for true altitude in degrees.
export const refractionDeg = (altDeg) => (altDeg < -1.5 ? 0 : 1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * D2R) / 60);

// ------------------------------------------------------------ galactic frame
// Rows of the J2000 -> galactic rotation in scene axes:  l = atan2(g1.v, g0.v),  b = asin(g2.v).
export function galacticRows() {
  const ra0 = 192.85948 * D2R, de0 = 27.12825 * D2R;
  const gz = [Math.cos(de0) * Math.cos(ra0), Math.cos(de0) * Math.sin(ra0), Math.sin(de0)];
  const rc = 266.40499 * D2R, dc = -28.93617 * D2R;
  let gx = [Math.cos(dc) * Math.cos(rc), Math.cos(dc) * Math.sin(rc), Math.sin(dc)];
  const k = gx[0] * gz[0] + gx[1] * gz[1] + gx[2] * gz[2];
  gx = gx.map((v, i) => v - k * gz[i]);
  const n = Math.hypot(...gx); gx = gx.map((v) => v / n);
  const gy = [gz[1] * gx[2] - gz[2] * gx[1], gz[2] * gx[0] - gz[0] * gx[2], gz[0] * gx[1] - gz[1] * gx[0]];
  const sc = ([x, y, z]) => new THREE.Vector3(x, z, -y);
  return [sc(gx), sc(gy), sc(gz)];
}
export const GAL_CENTER = { ra: 266.4168, dec: -29.0078 };

// Polaris (HIP 11767), J2000, and its place at a date.
export const POLARIS = { ra: 37.9545, dec: 89.2641 };
export function polarisOfDate(jd) {
  return vecToEq(eqToVec(POLARIS.ra, POLARIS.dec).applyMatrix4(precessionMatrix(jd)));
}

// ----------------------------------------------------------------- planets
export const PLANETS = [
  { id: 'mercury', body: 'Mercury', zh: '水星', en: 'Mercury', color: '#c9c2b4', radiusKm: 2439.7 },
  { id: 'venus', body: 'Venus', zh: '金星', en: 'Venus', color: '#fff1cf', radiusKm: 6051.8 },
  { id: 'mars', body: 'Mars', zh: '火星', en: 'Mars', color: '#ff8157', radiusKm: 3389.5 },
  { id: 'jupiter', body: 'Jupiter', zh: '木星', en: 'Jupiter', color: '#ffdcae', radiusKm: 69911 },
  { id: 'saturn', body: 'Saturn', zh: '土星', en: 'Saturn', color: '#ecd592', radiusKm: 58232 },
];

// The truth, per frame.  Everything in Earth radii, equator of date, scene axes:
//   sun, moon           geocentric positions
//   planets[id].geo     geocentric,  .helio  heliocentric,  .mag  apparent magnitude
//   earthHelio          heliocentric Earth (= -sun, without light-time)
export class Ephemeris {
  constructor() {
    this.jd = NaN;
    this.P = new THREE.Matrix4();
    this.sun = new THREE.Vector3(); this.moon = new THREE.Vector3(); this.earthHelio = new THREE.Vector3();
    this.planets = {};
    for (const p of PLANETS) this.planets[p.id] = { geo: new THREE.Vector3(), helio: new THREE.Vector3(), mag: 0 };
    this.moonFraction = 0; this.moonMag = -10; this.moonPhaseAngle = 0; this.moonElong = 0;
    this.gmst = 0;
    this._magJd = -1e9; this._v = new THREE.Vector3();
  }

  #rot(vec, scale, out) {
    const e = A.RotateVector(pRot, vec);
    return out.set(e.x, e.z, -e.y).multiplyScalar(scale);
  }

  update(jd) {
    if (jd === this.jd) return this;
    this.jd = jd;
    pFrame(jd);
    precessionMatrix(jd, this.P);
    this.gmst = gmstDeg(jd);
    const t = pTime;
    this.#rot(A.HelioVector('Earth', t), AU_R, this.earthHelio);
    this.sun.copy(this.earthHelio).negate();
    this.#rot(A.GeoMoon(t), AU_R, this.moon);
    for (const p of PLANETS) {
      const e = this.planets[p.id];
      this.#rot(A.HelioVector(p.body, t), AU_R, e.helio);
      e.geo.copy(e.helio).sub(this.earthHelio);
    }
    const il = A.Illumination('Moon', t);
    this.moonFraction = il.phase_fraction; this.moonMag = il.mag; this.moonPhaseAngle = il.phase_angle;
    this.moonElong = A.MoonPhase(t);                      // ecliptic elongation, 0 new, 180 full
    if (Math.abs(jd - this._magJd) > 0.04) {              // planet magnitudes change slowly
      this._magJd = jd;
      for (const p of PLANETS) this.planets[p.id].mag = A.Illumination(p.body, t).mag;
    }
    return this;
  }
}

// ------------------------------------------- mean elements (Ptolemy, orrery)
// JPL approximate Keplerian elements, 1800-2050 (Standish):
// [a, da, e, de, I, dI, L, dL, varpi, dvarpi, Omega, dOmega] per Julian century.
export const ELEMENTS = {
  mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  venus: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
};
// Mean heliocentric longitude (deg, ecliptic J2000) of a planet (or 'earth') at jd.
export function meanLongitude(id, jd) {
  const el = ELEMENTS[id], T = centuries(jd);
  return mod(el[6] + el[7] * T, 360);
}
// Mean geocentric longitude of the Sun (deg).
export const sunMeanLon = (jd) => mod(meanLongitude('earth', jd) + 180, 360);
// Longitude of perihelion (deg).
export function perihelionLon(id, jd) {
  const el = ELEMENTS[id], T = centuries(jd);
  return mod(el[8] + el[9] * T, 360);
}

// ------------------------------------------------ additions used by sky.js / bodies.js
// Galactic centre (Sgr A*), J2000.
export const GALACTIC_CENTRE = { ra: 266.4168, dec: -29.0078 };

// Equatorial J2000 -> galactic rotation in scene axes, as a THREE.Matrix3 (for the Milky Way shader).
export function galacticMatrix() {
  const r = A.Rotation_EQJ_GAL().rot;       // astronomy-engine stores rot[col][row]
  // conjugate by S (std -> scene: (x, y, z) -> (x, z, -y)):  M_scene = S R S^T
  return new THREE.Matrix3().set(
    r[0][0], r[0][2], -r[0][1],
    r[2][0], r[2][2], -r[2][1],
    -r[1][0], -r[1][2], r[1][1],
  );
}

// Apparent magnitudes change slowly: cached per half day.  { mercury, venus, mars, jupiter, saturn, sun, moon }
const magCache = { key: null, mags: null };
export function planetMagnitudes(jd) {
  const key = Math.floor(jd * 2);
  if (magCache.key === key) return magCache.mags;
  const time = A.MakeTime(dateFromJd(key / 2));
  const mags = {};
  for (const p of PLANETS) mags[p.id] = A.Illumination(p.body, time).mag;
  mags.sun = -26.74;
  mags.moon = -12.7;
  magCache.key = key; magCache.mags = mags;
  return mags;
}
