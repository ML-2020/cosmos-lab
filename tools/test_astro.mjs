// Numerical checks of src/astro.js (the astronomy core every cosmology shares) against astronomy-engine and known values.
//   node tools/test_astro.mjs
import * as THREE from 'three';
import * as A from 'astronomy-engine';
import {
  jdFromDate, gmstDeg, lstDeg, J2000, precessionMatrix, eqToVec, vecToEq, POLARIS, polarisOfDate,
  altAz, localFrame, horizToDir, dirToHoriz, refractionDeg, galacticRows, GAL_CENTER, Ephemeris, PLANETS,
  meanLongitude, R2D, D2R, mod, R_EARTH_KM, AU_R,
} from '../src/astro.js';

let fails = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!cond) fails++; };
const f = (x, n = 3) => Number(x).toFixed(n);
const dAng = (a, b) => mod(a - b + 180, 360) - 180;

// 1. GMST
ok('GMST(J2000) = 280.4606', Math.abs(gmstDeg(J2000) - 280.46061837) < 1e-6);
const date = new Date('2026-10-14T14:00:00Z'), jd = jdFromDate(date);
const gmstA = A.SiderealTime(A.MakeTime(date)) * 15;
ok('GMST vs astronomy-engine', Math.abs(dAng(gmstDeg(jd), gmstA)) < 0.01, `diff ${f(dAng(gmstDeg(jd), gmstA), 5)} deg`);

// 2. Precession and Polaris
const up = new THREE.Vector3(0, 1, 0);
const pol0 = eqToVec(POLARIS.ra, POLARIS.dec), pol1 = pol0.clone().applyMatrix4(precessionMatrix(jd));
ok('Polaris offset J2000 = 0.74 deg', Math.abs(pol0.angleTo(up) * R2D - 0.7359) < 0.01, f(pol0.angleTo(up) * R2D));
ok('Polaris offset in 2026 = 0.63 deg (dec 89.37)', Math.abs(pol1.angleTo(up) * R2D - 0.63) < 0.03, f(pol1.angleTo(up) * R2D));
ok('precession matrix is a rotation', Math.abs(precessionMatrix(jd).determinant() - 1) < 1e-9);

// 3. Horizon coordinates vs astronomy-engine (Sirius from Shanghai)
const lat = 31.2304, lon = 121.4737;
const sv = eqToVec(101.2872, -16.7161).applyMatrix4(precessionMatrix(jd)), sEq = vecToEq(sv), lst = lstDeg(jd, lon);
const mine = altAz(sEq.ra, sEq.dec, lst, lat);
const hor = A.Horizon(date, new A.Observer(lat, lon, 0), sEq.ra / 15, sEq.dec, null);
ok('altAz alt vs A.Horizon', Math.abs(mine.alt - hor.altitude) < 0.02, `${f(mine.alt)} vs ${f(hor.altitude)}`);
ok('altAz az vs A.Horizon', Math.abs(dAng(mine.az, hor.azimuth)) < 0.05, `${f(mine.az)} vs ${f(hor.azimuth)}`);

// 4. Observer frames: inertial-frame result equals the formula; round trip; orthonormal
const fr = localFrame(lat, lst), via = dirToHoriz(sv, fr);
ok('localFrame/dirToHoriz == altAz', Math.abs(via.alt - mine.alt) < 1e-6 && Math.abs(dAng(via.az, mine.az)) < 1e-6);
ok('horizToDir round trip', horizToDir(via.az, via.alt, fr).angleTo(sv) < 1e-9);
ok('east x north = up', fr.east.clone().cross(fr.north).angleTo(fr.up) < 1e-9);
const efr = localFrame(lat, lon);                                       // Earth-fixed frame: up is the place's direction
ok('Earth-fixed up at (lat, lon)', Math.abs(Math.asin(efr.up.y) * R2D - lat) < 1e-9);

// 5. Polaris stands (almost) as high as the latitude
for (const L of [0, 20, 31.23, 45, 60, 80]) {
  const p = polarisOfDate(jd), aa = altAz(p.ra, p.dec, lst, L);
  ok(`Polaris altitude ~ latitude ${L}`, Math.abs(aa.alt - L) < 0.75, `alt ${f(aa.alt, 2)}`);
}

// 6. Ephemeris: Sun, Moon and planets against astronomy-engine, in the equator of date
const eph = new Ephemeris().update(jd), obs0 = new A.Observer(0, 0, -6378140);          // geocentre (approximately)
const t = A.MakeTime(date);
const geo = (body) => { const v = A.GeoVector(body, t, true); return A.EquatorFromVector(A.RotateVector(A.Rotation_EQJ_EQD(t), v)); };
const sunE = vecToEq(eph.sun), sunA = geo('Sun');
ok('Sun RA vs astronomy-engine', Math.abs(dAng(sunE.ra, sunA.ra * 15)) < 0.02, `${f(sunE.ra)} vs ${f(sunA.ra * 15)}`);
ok('Sun Dec vs astronomy-engine', Math.abs(sunE.dec - sunA.dec) < 0.02, `${f(sunE.dec)} vs ${f(sunA.dec)}`);
const moonE = vecToEq(eph.moon), moonA = geo('Moon');
ok('Moon RA/Dec vs astronomy-engine', Math.abs(dAng(moonE.ra, moonA.ra * 15)) < 0.02 && Math.abs(moonE.dec - moonA.dec) < 0.02, `${f(moonE.ra)},${f(moonE.dec)} vs ${f(moonA.ra * 15)},${f(moonA.dec)}`);
ok('Moon distance 55-64 R_earth', moonE.r > 55 && moonE.r < 64.5, f(moonE.r, 2));
ok('Sun distance ~ 1 AU', Math.abs(sunE.r / AU_R - 1) < 0.02, f(sunE.r / AU_R, 4) + ' AU');
for (const p of PLANETS) {
  const e = vecToEq(eph.planets[p.id].geo), a = geo(p.body);
  ok(`${p.en} RA/Dec vs astronomy-engine`, Math.abs(dAng(e.ra, a.ra * 15)) < 0.05 && Math.abs(e.dec - a.dec) < 0.05, `${f(e.ra, 2)},${f(e.dec, 2)} vs ${f(a.ra * 15, 2)},${f(a.dec, 2)}`);
}
const elong = (v, s) => v.angleTo(s) * R2D;
ok('Mercury elongation < 29 deg', elong(eph.planets.mercury.geo, eph.sun) < 29);
ok('Venus elongation < 48 deg', elong(eph.planets.venus.geo, eph.sun) < 48);
ok('helio Earth = -geo Sun', eph.earthHelio.clone().add(eph.sun).length() < 1e-6);
ok('moon fraction in [0, 1]', eph.moonFraction >= 0 && eph.moonFraction <= 1, f(eph.moonFraction, 3));

// 7. Galactic frame
const [gx, gy, gz] = galacticRows(), gc = eqToVec(GAL_CENTER.ra, GAL_CENTER.dec);
const l = Math.atan2(gy.dot(gc), gx.dot(gc)) * R2D, b = Math.asin(gz.dot(gc)) * R2D;
ok('Sgr A* is l = 359.944, b = -0.046', Math.abs(l + 0.0558) < 0.01 && Math.abs(b + 0.0462) < 0.01, `l ${f(l, 4)} b ${f(b, 4)}`);

// 8. Mean elements and refraction
ok('Earth mean longitude at J2000 = 100.46', Math.abs(meanLongitude('earth', J2000) - 100.46457166) < 1e-6);
ok('refraction at the horizon ~ 0.5 deg', refractionDeg(0) > 0.45 && refractionDeg(0) < 0.62, f(refractionDeg(0)));
ok('refraction negligible at zenith', refractionDeg(90) < 0.001);

// 9. Geomagnetic field (WMM) against the NOAA reference values / the reference implementation
import { field, dipPole, geomagneticPole, magneticState, bearingTo } from '../src/magnetic.js';
import { activeShowers, SHOWERS } from '../src/fx/meteors.js';
const n20 = dipPole(true, 2020.0), s20 = dipPole(false, 2020.0), g20 = geomagneticPole(2020.0);
ok('north dip pole 2020.0 = 86.50N 164.04E (NOAA)', Math.abs(n20.lat - 86.50) < 0.02 && Math.abs(n20.lon - 164.04) < 0.1, `${f(n20.lat, 2)} ${f(n20.lon, 2)}`);
ok('south dip pole 2020.0 = 64.07S 135.88E', Math.abs(s20.lat + 64.07) < 0.05 && Math.abs(s20.lon - 135.88) < 0.1, `${f(s20.lat, 2)} ${f(s20.lon, 2)}`);
ok('geomagnetic pole 2020.0 = 80.6N 72.7W', Math.abs(g20.lat - 80.59) < 0.05 && Math.abs(g20.lon + 72.68) < 0.1, `${f(g20.lat, 2)} ${f(g20.lon, 2)}`);
const w1 = field(80, 0, 0, 2020.0), w2 = field(0, 120, 0, 2020.0);
ok('WMM2020 (80N, 0E): D -1.28, I 83.14', Math.abs(w1.decl + 1.28) < 0.02 && Math.abs(w1.incl - 83.14) < 0.02, `${f(w1.decl, 2)} ${f(w1.incl, 2)}`);
ok('WMM2020 (0N, 120E): D 0.16, I -15.42', Math.abs(w2.decl - 0.16) < 0.02 && Math.abs(w2.incl + 15.42) < 0.02, `${f(w2.decl, 2)} ${f(w2.incl, 2)}`);
const sh = field(31.2304, 121.4737, 0, 2026.83);
ok('Shanghai declination late 2026 ~ -6.6 (west)', Math.abs(sh.decl + 6.56) < 0.1 && Math.abs(sh.incl - 47.4) < 0.2, `${f(sh.decl, 2)} ${f(sh.incl, 1)}`);
const st = magneticState(2026.83);
ok('inclination is vertical at the dip poles', Math.abs(field(st.dipN.lat, st.dipN.lon, 0, 2026.83).incl - 90) < 0.01 && Math.abs(field(st.dipS.lat, st.dipS.lon, 0, 2026.83).incl + 90) < 0.01);
ok('bearing Shanghai -> north dip pole is northish', bearingTo(31.23, 121.47, st.dipN.lat, st.dipN.lon).az < 15 || bearingTo(31.23, 121.47, st.dipN.lat, st.dipN.lon).az > 345);
// 10. meteor showers
ok('Perseids active on Aug 12 (ZHR ~ 100)', activeShowers(jdFromDate(new Date('2026-08-12T12:00:00Z')))[0]?.id === 'PER');
ok('Geminids lead on Dec 14', activeShowers(jdFromDate(new Date('2026-12-14T12:00:00Z')))[0]?.id === 'GEM');
ok('no big shower on Mar 5', activeShowers(jdFromDate(new Date('2026-03-05T12:00:00Z'))).every((x) => x.zhrNow < 20));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
