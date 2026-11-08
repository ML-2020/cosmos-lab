// "日月对照" block of the hypothesis sheet: what each cosmology predicts for the Sun and the Moon from this place, on one set of axes,
// next to the real thing. Three line charts (Sun altitude today, Sun apparent diameter today, Moon apparent diameter over 30 days), a table
// of the same numbers, and a plain-language reading for the cosmology on screen. All numbers come from app.ephB + model.skyAt (see app.lumAt).
import { h, zoned, fromZoned, pad } from './dom.js';
import { jdFromDate, dateFromJd } from '../astro.js';
import { Cosmology } from '../models/base.js';
import { paramKey } from '../fx/lumpaths.js';
import { LUM_INTRO, LUM_TEXT, LUM_NOTE } from './text.js';

const IDS = ['flat', 'globe', 'ptolemy', 'helio'];
const NAME = { flat: '地平说', globe: '巨球论', ptolemy: '地心说', helio: '日心说' };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const NH = 48, ND = 30, NHOUR = 24;                      // today: a sample every 30 min; Moon: 31 days, 24 samples each to find its highest moment
const W = 340, H = 132, ML = 36, MR = 8, MT = 8, MB = 20;
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
  for (const c of kids.flat()) if (c) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const arcmin = (r, d) => 2 * Math.atan(r / d) * R2D * 60;
const sep = (a, b) => { const A = a.alt * D2R, B = b.alt * D2R, dz = (a.az - b.az) * D2R; return Math.acos(Math.min(1, Math.max(-1, Math.sin(A) * Math.sin(B) + Math.cos(A) * Math.cos(B) * Math.cos(dz)))) * R2D; };

function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, t = [];
  for (let v = a; v <= b + step * 1e-6; v += step) t.push(+v.toFixed(6));
  return { lo: a, hi: b, ticks: t };
}
const range = (arr) => { let lo = Infinity, hi = -Infinity; for (const v of arr) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } return lo <= hi ? [lo, hi] : null; };
const f1 = (v) => v.toFixed(1);
const span = (r, tight = 0.6) => !r ? '—' : (r[1] - r[0] < tight ? `${f1((r[0] + r[1]) / 2)}′` : `${f1(r[0])}–${f1(r[1])}′`);

export class LumChart {
  constructor(app) {
    this.app = app; this.hidden = new Set(); this.key = ''; this.wantKey = ''; this.data = null; this.job = null; this.timer = 0; this.sel = null;
    this.figs = [this.#fig({ id: 'alt', title: '太阳高度 · 今天', unit: '°', digits: 1, xs: 'day' }),
      this.#fig({ id: 'sun', title: '太阳视直径 · 今天白天', unit: '′', digits: 1, xs: 'day', zero: true }),
      this.#fig({ id: 'moon', title: '月亮视直径 · 今后 30 天', unit: '′', digits: 1, xs: 'month', zero: true })];
    this.legend = h('div', { class: 'lumleg', role: 'group', 'aria-label': '显示哪些体系' },
      ...IDS.map((id) => h('button', { class: 'lk', 'data-id': id, 'aria-pressed': 'true', onclick: () => this.#toggle(id) }, h('i', { class: `ln s-${id}` }), NAME[id])),
      h('span', { class: 'lk real' }, h('i', { class: 'ln s-real' }), '实际'));
    this.table = h('table', { class: 'lumtab' });
    this.text = h('p', { class: 'mtext' });
    this.state = h('p', { class: 'mnote lumstate' });
    this.el = h('div', { class: 'magblock lumblock' }, h('p', { class: 'tag', text: '日月对照 · 同一天的各家预言' }),
      h('p', { class: 'mtext', text: LUM_INTRO }), this.legend, ...this.figs.map((f) => f.el), this.table, this.text, this.state,
      h('p', { class: 'mnote', text: LUM_NOTE }), h('p', { class: 'msrc', text: '数据：本站天文历表与四套体系的模型（真实计算）' }));
  }

  // ------------------------------------------------------------------ figure scaffolding
  #fig(o) {
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lumsvg', role: 'img', tabindex: '0', 'aria-label': o.title });
    const g = { grid: sv('g', { class: 'lg' }), lines: sv('g'), mark: sv('line', { class: 'lmark', y1: MT, y2: H - MB, opacity: 0 }), cross: sv('line', { class: 'lcross', y1: MT, y2: H - MB, opacity: 0 }), empty: sv('text', { class: 'lempty', x: ML + (W - ML - MR) / 2, y: MT + (H - MT - MB) / 2, 'text-anchor': 'middle' }) };
    const hit = sv('rect', { x: ML, y: MT, width: W - ML - MR, height: H - MT - MB, fill: 'transparent' });
    svg.append(g.grid, g.mark, g.lines, g.cross, g.empty, hit);
    const tip = h('div', { class: 'lumtip', hidden: true });
    const el = h('figure', { class: 'lumfig' }, h('figcaption', { text: o.title }), svg, tip);
    const f = { ...o, el, svg, g, tip, series: null, dom: null, n: 0 };
    const at = (ev) => { const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * W; return Math.round((x - ML) / (W - ML - MR) * (f.n - 1)); };
    svg.addEventListener('pointermove', (ev) => this.#hover(f, at(ev)));
    svg.addEventListener('pointerleave', () => this.#hover(f, null));
    svg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return; ev.preventDefault();
      const i = f.sel == null ? Math.floor(f.n / 2) : f.sel + (ev.key === 'ArrowRight' ? 1 : -1); this.#hover(f, i);
    });
    svg.addEventListener('blur', () => this.#hover(f, null));
    return f;
  }
  #toggle(id) {
    if (this.hidden.has(id)) this.hidden.delete(id); else { if (this.hidden.size >= IDS.length - 1) return; this.hidden.add(id); }
    for (const b of this.legend.querySelectorAll('button')) b.setAttribute('aria-pressed', String(!this.hidden.has(b.dataset.id)));
    for (const f of this.figs) this.#draw(f);
  }

  // ------------------------------------------------------------------ computing
  // one pass over the sample instants: every model + the real thing share one ephemeris evaluation per instant
  #start(key, tz, z) {
    clearTimeout(this.timer); this.timer = 0;
    const app = this.app, S = app.S, models = IDS.map((id) => app.models[id]);
    const t0 = jdFromDate(new Date(fromZoned(z.y, z.mo, z.d, 0, 0, tz))), t1 = jdFromDate(new Date(fromZoned(z.y, z.mo, z.d + 1, 0, 0, tz)));
    const days = []; for (let i = 0; i <= ND; i++) days.push(jdFromDate(new Date(fromZoned(z.y, z.mo, z.d + i, 0, 0, tz))));
    const F = (n) => new Float32Array(n).fill(NaN);
    const d = { key, tz, t0, t1, hours: Array.from({ length: NH + 1 }, (_, i) => i * 24 / NH), alt: {}, sun: {}, sepS: {}, sepM: {}, moon: {}, maxAlt: {} };
    for (const id of [...IDS, 'real']) { d.alt[id] = F(NH + 1); d.sun[id] = F(NH + 1); d.moon[id] = F(ND + 1); d.sepS[id] = 0; d.sepM[id] = 0; d.maxAlt[id] = -90; }
    const outs = {}, realRad = Cosmology.prototype.lumRadii.call(models[0]), radii = Object.fromEntries(IDS.map((id, k) => [id, models[k].lumRadii()]));
    // stage list: [0] today at 48+1 instants; [1..] the 31 days of the Moon strip, 4 days per tick
    const day = (i) => t0 + (t1 - t0) * i / NH;
    const eval1 = (jd, fn) => {
      const e = app.ephB.update(jd);
      const real = Cosmology.prototype.skyAt.call(models[0], jd, e, S.lat, S.lon, outs.real ??= {});
      const r = { real, realRad };
      models.forEach((m, k) => { r[IDS[k]] = m.skyAt(jd, e, S.lat, S.lon, outs[IDS[k]] ??= {}); });
      fn(r);
    };
    const today = () => {
      for (let i = 0; i <= NH; i++) eval1(day(i), (r) => {
        for (const id of [...IDS, 'real']) {
          const s = r[id].sun, rad = id === 'real' ? realRad : radii[id];
          d.alt[id][i] = s.alt; if (s.alt > d.maxAlt[id]) d.maxAlt[id] = s.alt;
          if (s.alt >= -0.3 && Number.isFinite(s.dist) && s.dist > 0) d.sun[id][i] = arcmin(rad.sun, s.dist);
          if (id !== 'real') {
            if (r.real.sun.alt > 0) d.sepS[id] = Math.max(d.sepS[id], sep(s, r.real.sun));
            if (r.real.moon.alt > 0) d.sepM[id] = Math.max(d.sepM[id], sep(r[id].moon, r.real.moon));
          }
        }
      });
    };
    const month = (a, b) => {
      for (let i = a; i < Math.min(b, ND + 1); i++) {
        const best = {}, step = ((days[i + 1] ?? (days[i] + 1)) - days[i]) / NHOUR;
        for (let k = 0; k < NHOUR; k++) eval1(days[i] + k * step, (r) => {
          for (const id of [...IDS, 'real']) {
            const m = r[id].moon;
            if (!best[id] || m.alt > best[id].alt) best[id] = { alt: m.alt, dist: m.dist };
          }
        });
        for (const id of [...IDS, 'real']) { const b = best[id], rad = id === 'real' ? realRad : radii[id]; if (b && b.alt >= -0.3 && Number.isFinite(b.dist) && b.dist > 0) d.moon[id][i] = arcmin(rad.moon, b.dist); }
      }
    };
    this.job = { key, d, stage: 0, next: 0, today, month, done: false };
  }
  #tick() {
    const j = this.job; this.timer = 0; if (!j) return;
    if (j.key !== this.wantKey) { this.job = null; return; }          // the day/place changed meanwhile: that result is not wanted any more
    try {
      if (j.stage === 0) { j.today(); j.stage = 1; }
      else { j.month(j.next, j.next + 4); j.next += 4; if (j.next > ND) j.done = true; }
    } catch (e) { console.warn('[lumchart]', e); this.job = null; this.failed = j.key; return; }
    if (j.done) { this.data = j.d; this.key = j.key; this.job = null; this.#render(); return; }
    this.timer = setTimeout(() => this.#tick(), 0);
  }

  // ------------------------------------------------------------------ drawing
  #render() {
    const d = this.data, S = this.app.S; if (!d) return;
    const alt = this.figs[0], sun = this.figs[1], moon = this.figs[2];
    Object.assign(alt, { series: d.alt, n: NH + 1, x: d.hours });
    Object.assign(sun, { series: d.sun, n: NH + 1, x: d.hours });
    Object.assign(moon, { series: d.moon, n: ND + 1, x: Array.from({ length: ND + 1 }, (_, i) => i) });
    alt.xt = sun.xt = [0, 6, 12, 18, 24].map((v) => ({ v, t: pad(v) + ':00' }));
    moon.xt = [0, 10, 20, 30].map((v) => ({ v, t: v === 0 ? '今天' : `+${v} 天` }));
    for (const f of this.figs) {
      const all = []; for (const id of [...IDS, 'real']) all.push(...f.series[id]);
      const r = range(all); let lo = r ? r[0] : 0, hi = r ? r[1] : 1;
      if (f.zero) lo = 0; else { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (f.id === 'alt') {                                                      // altitude: whole 30° steps, never beyond ±90°
        const a = Math.max(-90, Math.floor(lo / 30) * 30), b = Math.min(90, Math.ceil(hi / 30) * 30), t = [];
        for (let v = a; v <= b; v += 30) t.push(v); f.dom = { lo: a, hi: b, ticks: t };
      } else { const pad2 = (hi - lo) * 0.06; f.dom = niceTicks(f.zero ? 0 : lo - pad2, hi + pad2, 4); }
      f.hasData = !!r; this.#draw(f);
    }
    this.#table();
    this.refresh();
    this.state.textContent = '';
  }
  #X(f, v) { const a = f.x[0], b = f.x[f.n - 1]; return ML + (v - a) / (b - a) * (W - ML - MR); }
  #Y(f, v) { return MT + (1 - (v - f.dom.lo) / (f.dom.hi - f.dom.lo)) * (H - MT - MB); }
  #draw(f) {
    if (!f.series || !f.dom) return;
    const g = f.g, cur = this.app.S.model;
    g.grid.replaceChildren(); g.lines.replaceChildren();
    for (const v of f.dom.ticks) {
      const y = this.#Y(f, v);
      g.grid.append(sv('line', { x1: ML, x2: W - MR, y1: y, y2: y, class: v === 0 && !f.zero ? 'lz' : '' }), sv('text', { x: ML - 5, y: y + 3.5, 'text-anchor': 'end' }, f.unit === '°' ? v + '°' : v + '′'));
    }
    for (const t of f.xt) g.grid.append(sv('text', { x: this.#X(f, t.v), y: H - 5, 'text-anchor': t.v === f.x[0] ? 'start' : t.v === f.x[f.n - 1] ? 'end' : 'middle' }, t.t));
    const path = (arr) => {
      let dd = '', pen = false;
      for (let i = 0; i < f.n; i++) {
        const v = arr[i]; if (!Number.isFinite(v)) { pen = false; continue; }
        dd += `${pen ? 'L' : 'M'}${this.#X(f, f.x[i]).toFixed(1)} ${this.#Y(f, v).toFixed(1)}`; pen = true;
      }
      return dd;
    };
    const dReal = path(f.series.real);
    if (dReal) g.lines.append(sv('path', { d: dReal, class: 'lr' }));
    const order = [cur, ...IDS.filter((id) => id !== cur)];                    // the cosmology on screen first (solid, thicker), the others dashed on top so overlaps show
    for (const id of order) {
      if (this.hidden.has(id)) continue;
      const dd = path(f.series[id]); if (!dd) continue;
      g.lines.append(sv('path', { d: dd, class: `lp s-${id}${id === cur ? ' cur' : ''}`, 'stroke-dashoffset': id === cur ? null : IDS.indexOf(id) * 3.5 }));
    }
    g.empty.textContent = f.hasData ? '' : (f.id === 'moon' ? '这 30 天里月亮都不在地平线上' : '今天太阳不在地平线上');
    f.svg.setAttribute('aria-label', `${f.title}。` + IDS.filter((id) => !this.hidden.has(id)).map((id) => { const r = range(f.series[id]); return r ? `${NAME[id]} ${f1(r[0])} 到 ${f1(r[1])}${f.unit}` : `${NAME[id]} 无数据`; }).join('；'));
    if (f.sel != null) this.#hover(f, f.sel);
  }
  #hover(f, i) {
    if (i == null || !f.series || !f.dom) { f.sel = null; f.g.cross.setAttribute('opacity', 0); f.tip.hidden = true; return; }
    i = Math.max(0, Math.min(f.n - 1, i)); f.sel = i;
    const x = this.#X(f, f.x[i]); f.g.cross.setAttribute('x1', x); f.g.cross.setAttribute('x2', x); f.g.cross.setAttribute('opacity', 1);
    const rows = [], fmt = (v) => Number.isFinite(v) ? f1(v) + f.unit : '—';
    const label = f.id === 'moon' ? (i === 0 ? '今天' : `+${i} 天`) : (() => { const hh = Math.floor(f.x[i]), mm = Math.round((f.x[i] - hh) * 60); return `${pad(hh)}:${pad(mm)}`; })();
    for (const id of [...IDS.filter((k) => !this.hidden.has(k)), 'real'])
      rows.push(h('div', { class: 'tr' }, h('i', { class: `ln s-${id === 'real' ? 'real' : id}` }), h('b', { text: fmt(f.series[id][i]) }), h('span', { text: id === 'real' ? '实际' : NAME[id] })));
    f.tip.replaceChildren(h('div', { class: 'th', text: label }), ...rows); f.tip.hidden = false;
    const w = f.svg.getBoundingClientRect().width || W, px = x / W * w, tw = f.tip.offsetWidth || 110;
    f.tip.style.left = Math.max(0, Math.min(w - tw, px + 10 > w - tw ? px - tw - 10 : px + 10)) + 'px';
  }

  #summary(id) {
    const d = this.data; if (!d) return null;
    const rg = (o) => range(o[id]), sr = rg(d.sun), mr = rg(d.moon);
    return { sr, mr, maxAlt: d.maxAlt[id], sepS: d.sepS[id], sepM: d.sepM[id] };
  }
  #table() {
    const d = this.data; if (!d) return;
    const err = (v) => v < 0.05 ? '≈ 0°' : v < 1 ? v.toFixed(2) + '°' : v.toFixed(1) + '°';
    const row = (id) => {
      const s = this.#summary(id), real = id === 'real';
      return h('tr', { 'data-id': id }, h('th', { scope: 'row' }, h('i', { class: `ln s-${id}` }), real ? '实际' : NAME[id]),
        h('td', { text: real ? '—' : `${err(s.sepS)} / ${err(s.sepM)}` }), h('td', { text: span(s.sr) }), h('td', { text: span(s.mr, 1.5) }));
    };
    this.table.replaceChildren(h('thead', {}, h('tr', {}, h('th', { text: '体系' }), h('th', { text: '方向偏差 日/月' }), h('th', { text: '日视径' }), h('th', { text: '月视径' }))),
      h('tbody', {}, ...IDS.map(row), row('real')));
  }

  // called when the cosmology on screen changes, and after every render
  refresh() {
    const d = this.data, id = this.app.S.model;
    for (const f of this.figs) this.#draw(f);
    for (const tr of this.table.querySelectorAll('tbody tr')) tr.classList.toggle('cur', tr.dataset.id === id);
    if (!d) { this.text.textContent = ''; return; }
    const s = this.#summary(id), r = this.#summary('real'), ratio = (x) => x ? x[1] / x[0] : 1;
    const fm = (x) => span(x, 1.5);
    this.text.textContent = LUM_TEXT[id]({
      maxAlt: s.maxAlt, realMaxAlt: r.maxAlt, sun: span(s.sr), realSun: span(r.sr), moon: fm(s.mr), realMoon: fm(r.mr),
      sunRatio: ratio(s.sr), moonRatio: ratio(s.mr), realMoonRatio: ratio(r.mr), sepS: s.sepS, sepM: s.sepM,
    });
  }

  // ------------------------------------------------------------------ driven from the sheet's 220 ms tick
  update() {
    const app = this.app, S = app.S;
    const tz = app.tz || 'UTC', z = zoned(dateFromJd(S.jd).getTime(), tz);
    const key = [tz, S.lat.toFixed(2), S.lon.toFixed(2), `${z.y}-${z.mo}-${z.d}`, IDS.map((id) => paramKey(app.models[id])).join('')].join('|');
    if (key === this.key) { this.el.classList.remove('stale'); if (this.state.textContent) this.state.textContent = ''; }
    else if (key !== this.wantKey && key !== this.failed) {
      if (Math.abs(S.rate) > 20000) { this.state.textContent = this.data ? '时间走得太快，图表停在之前那一天；放慢或暂停后更新。' : '时间走得太快，暂停或放慢后才会计算。'; this.el.classList.toggle('stale', !!this.data); }
      else { this.wantKey = key; this.state.textContent = this.data ? '' : '计算中…'; this.#start(key, tz, z); this.timer = setTimeout(() => this.#tick(), 0); this.el.classList.remove('stale'); }
    }
    // "now" marker on the two charts that show today
    if (this.data && key === this.key) {
      const frac = (S.jd - this.data.t0) / (this.data.t1 - this.data.t0);
      for (const f of this.figs.slice(0, 2)) { const x = ML + Math.max(0, Math.min(1, frac)) * (W - ML - MR); f.g.mark.setAttribute('x1', x); f.g.mark.setAttribute('x2', x); f.g.mark.setAttribute('opacity', frac >= 0 && frac <= 1 ? 1 : 0); }
    }
  }
}
