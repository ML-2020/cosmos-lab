// Earth's magnetic field, from NOAA's World Magnetic Model (WMM2025, degree/order 12).
// Real numbers only: declination at a place, the two dip poles (where a compass needle would stand on end),
// and the geomagnetic poles (the ends of the best-fitting tilted bar magnet, around which the aurora ovals sit).
import { WMM } from './generated/wmm.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const A_WGS = 6378.137, F_WGS = 1 / 298.257223563, E2 = F_WGS * (2 - F_WGS), A_REF = 6371.2;
const NMAX = 12;
const idx = (n, m) => (n * (n + 1)) / 2 + m;

export const yearOfJd = (jd) => 2000 + (jd - 2451545.0) / 365.25;

function model(year) { return year < 2022.5 ? WMM.wmm2020 : WMM.wmm2025; }

// Schmidt semi-normalised Legendre functions of sin(phi'), and their derivative with respect to phi'.
const P = new Float64Array(91), dP = new Float64Array(91);
function legendre(phi) {
  const x = Math.sin(phi), s = Math.cos(phi);
  P[0] = 1; dP[0] = 0;
  for (let n = 1; n <= NMAX; n++) {
    for (let m = 0; m <= n; m++) {
      const i = idx(n, m);
      if (m === n) {
        if (n === 1) { P[i] = s; dP[i] = -x; }
        else { const k = Math.sqrt((2 * n - 1) / (2 * n)), j = idx(n - 1, n - 1); P[i] = k * s * P[j]; dP[i] = k * (-x * P[j] + s * dP[j]); }
      } else {
        const a = idx(n - 1, m), b = n >= 2 ? idx(n - 2, m) : -1;
        const q = Math.sqrt(n * n - m * m), r = (n >= 2 && m <= n - 2) ? Math.sqrt((n - 1 + m) * (n - 1 - m)) : 0;
        P[i] = ((2 * n - 1) * x * P[a] - (b >= 0 ? r * P[b] : 0)) / q;
        dP[i] = ((2 * n - 1) * (s * P[a] + x * dP[a]) - (b >= 0 ? r * dP[b] : 0)) / q;
      }
    }
  }
}

// Field at a geodetic place.  Returns nT components (X north, Y east, Z down) and angles in degrees.
export function field(latDeg, lonDeg, altKm = 0, year = 2026.0) {
  const M = model(year), dt = year - M.epoch;
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const rc = A_WGS / Math.sqrt(1 - E2 * sl * sl);
  const p = (rc + altKm) * cl, z = (rc * (1 - E2) + altKm) * sl;
  const r = Math.hypot(p, z), phi = Math.asin(z / r);
  legendre(phi);
  const cphi = Math.cos(phi);
  let Xp = 0, Yp = 0, Zp = 0;
  const ar = A_REF / r;
  let pw = ar * ar;                                      // (a/r)^(n+2), starts at n = 0
  for (let n = 1; n <= NMAX; n++) {
    pw *= ar;
    for (let m = 0; m <= n; m++) {
      const i = idx(n, m);
      const g = M.g[i] + dt * M.gs[i], h = M.h[i] + dt * M.hs[i];
      const cm = Math.cos(m * lon), sm = Math.sin(m * lon);
      Xp -= pw * (g * cm + h * sm) * dP[i];
      Yp += pw * m * (g * sm - h * cm) * P[i];
      Zp -= pw * (n + 1) * (g * cm + h * sm) * P[i];
    }
  }
  Yp = Math.abs(cphi) < 1e-9 ? 0 : Yp / cphi;           // at the geographic poles Y' is a limit; the dip-pole search never lands exactly there
  const psi = phi - lat;
  const X = Xp * Math.cos(psi) - Zp * Math.sin(psi), Z = Xp * Math.sin(psi) + Zp * Math.cos(psi), Y = Yp;
  const H = Math.hypot(X, Y), F = Math.hypot(H, Z);
  return { X, Y, Z, H, F, decl: Math.atan2(Y, X) * R2D, incl: Math.atan2(Z, H) * R2D };
}

// ---------------------------------------------------------------- vectors on the unit sphere (x to lon 0, z to the north pole)
const ll2v = (lat, lon) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
const v2ll = (v) => [Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D, Math.atan2(v[1], v[0]) * R2D];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// horizontal field as a 3-vector tangent to the sphere at v
function hvec(v, year) {
  const [lat, lon] = v2ll(v), f = field(lat, lon, 0, year);
  const sl = Math.sin(lat * D2R), cl = Math.cos(lat * D2R), so = Math.sin(lon * D2R), co = Math.cos(lon * D2R);
  const N = [-sl * co, -sl * so, cl], E = [-so, co, 0];
  return [f.X * N[0] + f.Y * E[0], f.X * N[1] + f.Y * E[1], f.X * N[2] + f.Y * E[2]];
}

// Dip pole: where the horizontal field vanishes (inclination ±90°).  Newton iteration on the sphere.
export function dipPole(north, year) {
  let v = norm(ll2v(north ? 86 : -64.5, north ? 160 : 137));
  for (let it = 0; it < 30; it++) {
    const e1 = norm(cross(v, Math.abs(v[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), e2 = cross(v, e1);
    const h0 = hvec(v, year), eps = 2e-4;
    const col = (e) => { const w = norm([v[0] + eps * e[0], v[1] + eps * e[1], v[2] + eps * e[2]]); const h = hvec(w, year); return [(dot(h, e1) - dot(h0, e1)) / eps, (dot(h, e2) - dot(h0, e2)) / eps]; };
    const c1 = col(e1), c2 = col(e2);                               // J = [c1 c2] (columns)
    const det = c1[0] * c2[1] - c2[0] * c1[1];
    const b = [-dot(h0, e1), -dot(h0, e2)];
    const d1 = (b[0] * c2[1] - c2[0] * b[1]) / det, d2 = (c1[0] * b[1] - b[0] * c1[1]) / det;
    v = norm([v[0] + d1 * e1[0] + d2 * e2[0], v[1] + d1 * e1[1] + d2 * e2[1], v[2] + d1 * e1[2] + d2 * e2[2]]);
    if (Math.hypot(d1, d2) < 1e-9) break;
  }
  const [lat, lon] = v2ll(v);
  return { lat, lon, H: Math.hypot(...hvec(v, year)) };
}

// Geomagnetic (tilted-dipole) poles from the three degree-1 Gauss coefficients.
export function geomagneticPole(year) {
  const M = model(year), dt = year - M.epoch;
  const g10 = M.g[idx(1, 0)] + dt * M.gs[idx(1, 0)], g11 = M.g[idx(1, 1)] + dt * M.gs[idx(1, 1)], h11 = M.h[idx(1, 1)] + dt * M.hs[idx(1, 1)];
  const B0 = Math.hypot(g10, g11, h11);
  const lat = Math.asin(-g10 / B0) * R2D, lon = Math.atan2(h11, g11) * R2D + 180;
  return { lat, lon: ((lon + 540) % 360) - 180, B0, g10, g11, h11 };
}

// Everything the sky simulator wants to say about magnetism at one moment.
export function magneticState(year) {
  const n = dipPole(true, year), s = dipPole(false, year), g = geomagneticPole(year);
  return { year, dipN: n, dipS: s, geoN: { lat: g.lat, lon: g.lon }, geoS: { lat: -g.lat, lon: ((g.lon + 360) % 360) - 180 }, B0: g.B0, model: model(year).name };
}

// Great-circle initial bearing (deg, clockwise from true north) and distance (deg of arc) from a place to a pole.
export function bearingTo(lat1, lon1, lat2, lon2) {
  const a = lat1 * D2R, b = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(b), x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl)))) * R2D;
  return { az: (Math.atan2(y, x) * R2D + 360) % 360, dist: d };
}

// Geomagnetic latitude of a place (angle from the geomagnetic equator, tilted-dipole), and the bearing to the geomagnetic north pole.
export function geomagneticLat(lat, lon, year) {
  const g = geomagneticPole(year);
  const p = ll2v(g.lat, g.lon), q = ll2v(lat, lon);
  return Math.asin(Math.max(-1, Math.min(1, dot(p, q)))) * R2D;
}

// Points of one dipole field line (Earth-fixed unit vectors in radii; x to lon 0, z to the geographic north pole).
// `L` the shell (radius at the magnetic equator), `mlon` its geomagnetic longitude (deg), pole = geomagnetic north pole (lat, lon).
export function dipoleLine(L, mlon, pole, n = 40) {
  const zm = norm(ll2v(pole.lat, pole.lon));                    // magnetic axis, pointing at the geomagnetic north pole
  const c0 = cross([0, 0, 1], zm), x0 = norm(Math.hypot(...c0) < 1e-9 ? [1, 0, 0] : c0), y0 = cross(zm, x0);
  const l0 = Math.acos(Math.sqrt(1 / L)), pts = [], cm = Math.cos(mlon * D2R), sm = Math.sin(mlon * D2R);
  for (let i = 0; i <= n; i++) {
    const lam = -l0 + (2 * l0 * i) / n, r = L * Math.cos(lam) ** 2, cl = Math.cos(lam), sl = Math.sin(lam);
    pts.push([0, 1, 2].map((k) => r * (cl * (cm * x0[k] + sm * y0[k]) + sl * zm[k])));
  }
  return pts;
}

export { ll2v, v2ll };
