// One night at one place, sampled every ten minutes: Sun / Moon / Milky-Way-core altitudes, and the best moment to look up.
// Shared by the photographer's timeline and by the default time of the whole site.
import { localFrame, lstDeg, altAz, jdFromDate, dateFromJd, R2D } from '../astro.js';
import { zoned, fromZoned, clamp } from './dom.js';

const N = 109, LEN = 18 / 24;                      // 15:00 local -> 09:00 next day

// Local 15:00 (ms) of the evening this instant belongs to.  `upcoming`: during the day, mean tonight.
export function nightBase(jd, tz, upcoming = false) {
  const z = zoned(dateFromJd(jd).getTime(), tz);
  return fromZoned(z.y, z.mo, z.d, 15, 0, tz) - (z.h < (upcoming ? 9 : 12) ? 86400000 : 0);
}

export function sampleNight(eph, lat, lon, tz, jd, upcoming = false) {
  const base = nightBase(jd, tz, upcoming), t0 = jdFromDate(new Date(base)), fr = {};
  const sun = new Float32Array(N), moon = new Float32Array(N), gc = new Float32Array(N);
  let frac = 0;
  for (let i = 0; i < N; i++) {
    const j = t0 + (i / (N - 1)) * LEN; eph.update(j);
    const lst = lstDeg(j, lon); localFrame(lat, lst, fr);
    const alt = (p) => { const x = p.x - fr.up.x, y = p.y - fr.up.y, z = p.z - fr.up.z, L = Math.hypot(x, y, z); return Math.asin(clamp((x * fr.up.x + y * fr.up.y + z * fr.up.z) / L, -1, 1)) * R2D; };
    sun[i] = alt(eph.sun); moon[i] = alt(eph.moon); gc[i] = altAz(266.4168, -29.0078, lst, lat).alt;
    if (i === 54) frac = eph.moonFraction;
  }
  let lo = 99, hi = -99; for (let i = 0; i < N; i++) { lo = Math.min(lo, sun[i]); hi = Math.max(hi, sun[i]); }
  return { base, t0, len: LEN, N, sun, moon, gc, frac, kind: nightKind(lo, hi), sunMin: lo, sunMax: hi };
}

// What kind of night this is, from the lowest and highest Sun altitude over the window.
//   dark      an ordinary night with a proper astronomical night in it
//   day       the Sun never sets (polar day / midnight Sun)
//   twilight  the Sun sets but never gets below -18 deg: white nights, or the twilight season near the poles
//   polarnight the Sun stays below the horizon for the whole window and below -18 deg
export function nightKind(lo, hi) {
  if (lo > -0.83) return 'day';
  if (lo > -18) return hi < -0.83 ? 'twilight-polar' : 'twilight';
  return hi < -0.83 ? 'polarnight' : 'dark';
}

// First night, from `jd` on, that has a real astronomical night in it (steps of two days, then refined to the day).
// Returns { jd, n } with n the sampled night, or null if there is none within a year.
export function nextDarkNight(eph, lat, lon, tz, jd) {
  const probe = (d) => sampleNight(eph, lat, lon, tz, jd + d, true);
  let d = 0, n;
  for (; d <= 380; d += 2) { n = probe(d); if (n.sunMin < -18) break; }
  if (d > 380) return null;
  if (d > 0) { const m = probe(d - 1); if (m.sunMin < -18) { d -= 1; n = m; } }
  return { jd: jd + d, n, days: d };
}

// Best moment for looking at the sky: properly dark, Moon low or thin, the Milky Way's core up; ties go to the middle of the night.
export function bestMoment(n) {
  let mid = 0, lo = 99, cnt = 0, sum = 0;
  for (let i = 0; i < n.N; i++) { if (n.sun[i] < -18) { sum += i; cnt++; } if (n.sun[i] < lo) { lo = n.sun[i]; mid = i; } }
  if (cnt) mid = sum / cnt;
  let best = -1e9, bi = 0;
  for (let i = 0; i < n.N; i++) {
    const dark = clamp((-6 - n.sun[i]) / 12, 0, 1);
    const moonPen = n.moon[i] > -2 ? n.frac * clamp((n.moon[i] + 2) / 20, 0, 1) : 0;
    const core = n.gc[i] > 8 ? clamp(n.gc[i] / 45, 0, 1) * 0.35 : 0;
    const score = 3 * dark - 2.4 * moonPen + core - Math.abs(i - mid) * 0.002;
    if (score > best) { best = score; bi = i; }
  }
  return n.t0 + (bi / (n.N - 1)) * n.len;
}
