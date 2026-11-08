// Tiny DOM helpers, icons, number/time formatting.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

const ICONS = {
  mark: '<ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-24 12 12)"/><circle cx="12" cy="12" r="2.6"/><circle cx="20" cy="6.6" r="1.1" fill="currentColor"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>',
  back: '<path d="M16 5.5v13L5.5 12z"/>',
  layers: '<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5"/>',
  shot: '<path d="M4 8.5h3.2L9 5.5h6l1.8 3H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.6"/>',
  aperture: '<circle cx="12" cy="12" r="9"/><path d="M12 3l4.2 7.3M20.6 9.2L12 10.5M18.2 18l-5-6.5M9.3 20.7L12 12M3.2 14.7L12 12M5.8 6l6.2 6"/>',
  eye: '<path d="M2.8 12S6 6 12 6s9.2 6 9.2 6-3.2 6-9.2 6S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  pin: '<path d="M12 21s7-6.3 7-11.5a7 7 0 0 0-14 0C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sheet: '<path d="M4 5h16M4 12h10M4 19h16"/>',
  star: '<path d="M12 3.2l2.5 5.7 6.2.6-4.7 4.1 1.4 6.1L12 16.5l-5.4 3.2L8 13.6 3.3 9.5l6.2-.6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
};
export function icon(name, cls = 'i') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// distance in metres -> Chinese units
export function fmtDist(m) {
  const num = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '').replace(/\.0$/, ''));
  if (m < 1000) return `${num(m)} 米`;
  const km = m / 1000;
  if (km < 10000) return `${num(km)} 公里`;
  if (km < 1e8) return `${num(km / 1e4)} 万公里`;
  return `${num(km / 1e8)} 亿公里`;
}
// short form for ruler ticks
export function fmtTick(m) {
  if (m < 1000) return `${m} 米`;
  const km = m / 1000;
  if (km < 10000) return `${km} 公里`;
  if (km < 1e8) return `${km / 1e4} 万公里`;
  return `${km / 1e8} 亿公里`;
}

export const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
export const fmtLat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;

// ------------------------------------------------------------------ time zones
const fmtCache = new Map();
function parts(ts, tz) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); fmtCache.set(tz, f); }
  const o = {}; for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}
// zone offset in minutes at instant ts; tz may be an IANA name or a number of hours (solar time)
export function tzOffset(tz, ts) {
  if (typeof tz === 'number') return tz * 60;
  const p = parts(ts, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60000);
}
const WD = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
export function zoned(ts, tz) {
  const off = tzOffset(tz, ts), d = new Date(ts + off * 60000);
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: w, off };
}
export function fromZoned(y, mo, d, h, mi, tz) {
  let ts = Date.UTC(y, mo - 1, d, h, mi) - tzOffset(tz, Date.UTC(y, mo - 1, d, h, mi)) * 60000;
  ts = Date.UTC(y, mo - 1, d, h, mi) - tzOffset(tz, ts) * 60000;
  return ts;
}
export function offsetLabel(min) { const s = min < 0 ? '−' : '+'; const a = Math.abs(min); return `UTC${s}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`; }
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
