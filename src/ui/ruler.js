// The scale ruler: the one bold thing.  A logarithmic ruler along the bottom from "the whole model resting in your palm"
// to "a person standing on the ground".  The thumb IS the journey parameter; its flag reads the camera's distance.
import { h, fmtDist, fmtTick, clamp } from './dom.js';
import { LANDMARKS } from './text.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, kids = []) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); for (const c of kids) e.append(c); return e; };
const R_EARTH_M = 6.371e6;

export class Ruler {
  constructor(app) {
    this.app = app;
    this.svg = el('svg', { 'aria-hidden': 'true' });
    this.flag = h('b', { text: '' });
    this.thumb = h('div', { class: 'thumb' }, this.flag);
    this.root = h('div', { class: 'ruler', role: 'slider', tabindex: '0', 'aria-label': '尺度：从掌心到地面', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, this.svg, this.thumb);
    this._w = 1; this._z = -1; this._dist = null;
    const set = (ev) => {
      const r = this.root.getBoundingClientRect();
      const z = clamp((ev.clientX - r.left) / r.width, 0, 1);
      app._journey = null; app.set({ zoomTarget: z }); app.emit('zoom');
    };
    this.root.addEventListener('pointerdown', (ev) => { this.root.setPointerCapture(ev.pointerId); this._drag = true; set(ev); });
    this.root.addEventListener('pointermove', (ev) => { if (this._drag) set(ev); });
    const up = () => { this._drag = false; };
    this.root.addEventListener('pointerup', up); this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('keydown', (ev) => {
      const S = app.S, k = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02, PageDown: -0.1, PageUp: 0.1 }[ev.key];
      if (ev.key === 'Home') app.set({ zoomTarget: 0 }); else if (ev.key === 'End') app.set({ zoomTarget: 1 });
      else if (k) app.set({ zoomTarget: clamp(S.zoomTarget + k, 0, 1) }); else return;
      app._journey = null; ev.preventDefault();
    });
    new ResizeObserver(() => this.layout()).observe(this.root);
  }

  // metres from the focus at journey parameter z
  distM(z) { return this.app.curve(z) * R_EARTH_M; }

  // z at which the camera is `m` metres out (distance is monotone decreasing in z)
  zAt(m) {
    let lo = 0, hi = 1;
    if (m >= this.distM(0)) return 0; if (m <= this.distM(1)) return 1;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (this.distM(mid) > m) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  layout() {
    if (!this.app.curve) return;
    const W = this.root.clientWidth || 1000; this._w = W;
    const svg = this.svg; svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} 84`);
    const y0 = 52, dMax = this.distM(0), dMin = this.distM(1);
    svg.append(el('line', { x1: 0, x2: W, y1: y0, y2: y0, class: 'rt' }));
    // decade ticks (long, labelled), 2..9 ticks (short)
    const k0 = Math.floor(Math.log10(dMin)), k1 = Math.ceil(Math.log10(dMax));
    let lastLabel = -1e9;
    for (let k = k0; k <= k1; k++) for (let n = 1; n < 10; n++) {
      const m = n * 10 ** k; if (m < dMin * 0.999 || m > dMax * 1.001) continue;
      const x = this.zAt(m) * W, major = n === 1;
      if (!major && n !== 2 && n !== 5) continue;
      svg.append(el('line', { x1: x, x2: x, y1: y0, y2: y0 + (major ? 14 : 7), class: 'tk' + (major ? ' mj' : '') }));
      if (major && Math.abs(x - lastLabel) > 62 && x > 30 && x < W - 30) {
        const t = el('text', { x, y: y0 + 29 }); t.textContent = fmtTick(m); svg.append(t); lastLabel = x;
      }
    }
    // named distances
    let lastLm = -1e9;
    for (const L of LANDMARKS) {
      if (L.m < dMin * 1.02 || L.m > dMax * 0.98) continue;
      const x = this.zAt(L.m) * W; if (Math.abs(x - lastLm) < 58 || x < 54 || x > W - 54) continue; lastLm = x;
      svg.append(el('line', { x1: x, x2: x, y1: y0 - 12, y2: y0, class: 'lmk' }));
      const t = el('text', { x, y: y0 - 17, class: 'lm' }); t.textContent = L.name; svg.append(t);
    }
    // the lit part of the track, and the two ends: a hand cradling the model / a person standing
    this.fill = el('line', { x1: 0, x2: 0, y1: y0, y2: y0, class: 'fill' }); svg.append(this.fill);
    const palm = el('g', { transform: `translate(-2 ${y0 - 22})`, class: 'end' }, [
      el('path', { d: 'M-9 -3 Q-9 8 0 8 Q9 8 9 -3' }), el('circle', { cx: 0, cy: -3, r: 4.2 }),
    ]);
    const man = el('g', { transform: `translate(${W + 2} ${y0 - 22})`, class: 'end' }, [
      el('circle', { cx: 0, cy: -8, r: 2.6 }), el('path', { d: 'M0 -4.5V4M-4.5 -1.5L0 -3.6 4.5 -1.5M0 4L-3.4 11M0 4L3.4 11' }),
    ]);
    svg.append(palm, man);
    this._z = -1;
  }

  update() {
    const z = this.app.S.zoom, W = this._w;
    if (z === this._z && !this._dirty && this._w === this._lw) return;
    this._lw = this._w;
    this._z = z;
    const x = z * W;
    this.thumb.style.transform = `translateX(${x}px)`;
    if (this.fill) { this.fill.setAttribute('x2', x); }
    const d = fmtDist(this.distM(z));
    if (d !== this._dist) { this._dist = d; this.flag.textContent = d; this._fw = this.flag.offsetWidth; }
    // keep the flag inside the screen; its pointer stays on the thumb
    const half = (this._fw || 80) / 2, left = this.root.getBoundingClientRect().left + x;
    const dx = Math.max(0, 10 - (left - half)) - Math.max(0, left + half - (innerWidth - 10));
    this.flag.style.transform = `translateX(calc(-50% + ${dx.toFixed(1)}px))`; this.flag.style.setProperty('--dx', dx.toFixed(1) + 'px');
    this.root.setAttribute('aria-valuenow', String(Math.round(z * 100)));
    this.root.setAttribute('aria-valuetext', d);
  }
}
