// The interface controller: top bar, hypothesis sheet, comparison ledger, scale ruler + time dock, hero, pop-overs.
// Everything reads and writes the App's state `S`; nothing here touches the renderer.
import { h, icon, pad, fmtLat, fmtLon, zoned, fromZoned, offsetLabel, clamp } from './dom.js';
import { Ruler } from './ruler.js';
import { Labels } from './labels.js';
import { Photo } from './photo.js';
import { BRAND, HERO, SCALE_CAPTION, MODEL_TEXT, FLIP, UI as T, SPEEDS, PLACES, HEIGHTS, MAG_TEXT, MAG_COMMON } from './text.js';
import { activeShowers } from '../fx/meteors.js';
import { jdFromDate, dateFromJd, Ephemeris } from '../astro.js';
import { sampleNight, bestMoment, nextDarkNight } from './night.js';
import { LumChart } from './lumchart.js';

const MODEL_ORDER = ['flat', 'globe', 'ptolemy', 'helio'];
const MODEL_RGB = { flat: '255,178,61', globe: '53,224,200', ptolemy: '183,140,255', helio: '255,207,90' };
const KEY = 'cosmos-lab/v1';
const PERSIST = ['lat', 'lon', 'site', 'lines', 'equator', 'ecliptic', 'grid', 'dso', 'labels', 'guide', 'bortle', 'mw', 'ridges', 'aurora', 'kp', 'meteors', 'meteorBoost', 'sats', 'mag', 'paths', 'arcs', 'lumTrail'];
const MINUS = '−';
const fmtDeg = (v, d = 1) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) + '°';

export class UI {
  constructor(app, root, labelsEl, opts = {}) {
    this.app = app; this.root = root;
    this.place = { name: PLACES[0].name, tz: PLACES[0].tz }; app.tz = this.place.tz;
    this.opts = { caption: true, sheet: innerWidth > 900 };
    this.pop = null; this.photo = null; this._lastClock = ''; this._ledgerT = 0; this._arrived = false; this._flipT = 0;
    this.#load();
    this.labels = new Labels(app, labelsEl);
    this.ruler = new Ruler(app);
    this.#build(opts);
    this.photo = new Photo(app, this);
    this.#bind();
    this.refreshModel(true);
    this.refreshPlace(); this.refreshGuide(); this.goBest('initial'); this.refreshTime(true); this.refreshSpeed();
    app.onFrame = (ctx) => this.frame(ctx);
    document.fonts?.ready.then(() => this.layoutLens());
  }

  // ------------------------------------------------------------------ persistence
  #load() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!j) return;
      const S = {}; for (const k of PERSIST) if (j[k] !== undefined) S[k] = j[k];
      this.app.set(S);
      if (j.place) { this.place = j.place; this.app.tz = j.place.tz; }
      if (j.caption !== undefined) this.opts.caption = j.caption;
    } catch (e) { /* storage unavailable: defaults */ }
  }
  save() {
    try {
      const S = this.app.S, o = { place: this.place, caption: this.opts.caption };
      for (const k of PERSIST) o[k] = S[k];
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) { /* ignore */ }
  }

  // ----------------------------------------------------------------------- build
  #build(opts) {
    const app = this.app;
    // top bar
    this.lens = h('span', { class: 'lens' });
    this.switchBtns = {};
    this.switchEl = h('div', { class: 'switch', role: 'tablist', 'aria-label': '宇宙观' }, this.lens,
      MODEL_ORDER.map((id) => {
        const b = h('button', { role: 'tab', 'data-id': id, style: `--d:${MODEL_RGB[id]}`, onclick: () => this.setModel(id) }, h('i'), MODEL_TEXT[id].name);
        this.switchBtns[id] = b; return b;
      }));
    const L = (t) => h('span', { class: 'lbl', text: t });
    this.btnSheet = h('button', { class: 'btn opt', title: '假说说明', onclick: () => this.toggleSheet() }, icon('sheet'), L('假说'));
    this.btnPhoto = h('button', { class: 'btn', title: '摄影师模式 (P)', onclick: () => this.photo?.toggle() }, icon('aperture'), L(T.photo));
    this.btnGuide = h('button', { class: 'btn', title: '认星：标出北极星、北斗七星、猎户座、夏季大三角等耳熟能详的星 (G)', onclick: () => { app.set({ guide: !app.S.guide }); this.save(); this.refreshGuide(); } }, icon('star'), L('认星'));
    this.btnLayers = h('button', { class: 'btn opt', title: '图层', onclick: (e) => this.togglePop('layers', e.currentTarget) }, icon('layers'), L(T.layers));
    this.btnShot = h('button', { class: 'btn opt', title: '截图 (S)', onclick: () => this.screenshot() }, icon('shot'), L(T.shot));
    this.btnHide = h('button', { class: 'btn icon', title: T.hideUi + ' (H)', 'aria-label': T.hideUi, onclick: () => this.setClean(true) }, icon('eye'));
    this.btnFull = h('button', { class: 'btn icon', title: T.fullscreen, 'aria-label': T.fullscreen, onclick: () => this.fullscreen() }, icon('full'));
    this.top = h('header', { class: 'top' },
      h('div', { class: 'brand' }, (() => { const s = icon('mark'); s.removeAttribute('class'); return s; })(), h('span', { text: BRAND })),
      this.switchEl,
      h('div', { class: 'tools' }, this.btnSheet, this.btnPhoto, this.btnGuide, this.btnLayers, this.btnShot, this.btnHide, this.btnFull));

    // hypothesis sheet
    this.sheet = h('aside', { class: 'sheet', 'aria-label': '假说' });

    // ledger
    this.ledgerRows = new Map(); this.ledgerBody = h('div'); this.ledgerMoreBody = h('div', { hidden: true });
    this.moreBtn = h('button', { class: 'more', onclick: () => { this.moreOpen = !this.moreOpen; this.ledgerMoreBody.hidden = !this.moreOpen; this.moreBtn.firstChild.textContent = T.moreBodies; this.moreBtn.lastChild.textContent = this.moreOpen ? '收起' : '展开'; } }, h('span', { text: T.moreBodies }), h('span', { text: '展开' }));
    this.ledgerFoot = h('p', { class: 'foot' });
    this.ledger = h('aside', { class: 'ledger off', 'aria-label': T.compare },
      h('h3', { title: '点击折叠 / 展开', onclick: () => this.ledger.classList.toggle('min') }, T.compare, h('span', { text: T.altUnit })),
      h('div', { class: 'head' }, h('span'), h('span', { text: T.mine }), h('span', { text: T.real })),
      this.ledgerBody, this.moreBtn, this.ledgerMoreBody, this.ledgerFoot);

    // dock
    this.placeBtn = h('button', { class: 'btn place', onclick: (e) => this.togglePop('place', e.currentTarget) });
    this.rev = h('button', { class: 'pb', title: T.reverse, 'aria-label': T.reverse, 'aria-pressed': 'false', onclick: () => this.setRate(-app.S.rate) }, icon('back'));
    this.pp = h('button', { class: 'pb main', title: T.pause + ' (空格)', 'aria-label': T.pause, onclick: () => { app.S.playing = !app.S.playing; app.emit('state'); } });
    this.speedBtns = SPEEDS.map((s) => h('button', { 'aria-pressed': 'false', onclick: () => this.setRate(Math.sign(app.S.rate || 1) * s.rate) }, s.label));
    this.clockCh = Array.from({ length: 19 }, () => h('i')); this.clockB = h('b', {}, this.clockCh); this.clockS = h('span');
    this.clockIn = h('input', { type: 'datetime-local', 'aria-label': '观测时刻', step: '60', onchange: () => this.pickTime() });
    this.clock = h('div', { class: 'clock' }, this.clockB, this.clockS, this.clockIn);
    this.nowBtn = h('div', { class: 'speeds' },
      h('button', { text: T.bestBtn, title: '跳到这一夜最适合看星的时刻：天已全黑、月亮低或很细、银河在天上', onclick: () => this.goBest('button') }),
      h('button', { text: T.nowBtn, onclick: () => this.goNow() }));
    this.viewinfo = h('div', { class: 'viewinfo' });
    this.dock = h('footer', { class: 'dock' },
      this.ruler.root,
      h('div', { class: 'caps' }, h('span', { text: SCALE_CAPTION.palm }), h('span', { text: SCALE_CAPTION.ground })),
      h('div', { class: 'deck' }, this.placeBtn,
        h('div', { class: 'timebar' }, this.rev, this.pp, h('div', { class: 'speeds' }, this.speedBtns), this.clock, this.nowBtn),
        h('div', { class: 'grow' }), this.viewinfo));

    this.flip = h('div', { class: 'flip' }, h('b'), h('span'));
    this.veil = h('div', { class: 'veil' });
    this.ghost = h('button', { class: 'btn icon ghost', title: T.showUi + ' (H)', 'aria-label': T.showUi, onclick: () => this.setClean(false) }, icon('eye'));
    this.hero = opts.hero === false ? null : this.#buildHero();
    this.root.append(this.veil, this.top, this.sheet, this.ledger, this.dock, this.flip, this.ghost);
    if (this.hero) this.root.append(this.hero);
    this.ruler.layout();
  }

  #buildHero() {
    const app = this.app;
    this.heroPick = {};
    const pick = h('div', { class: 'pick', role: 'group', 'aria-label': HERO.caption }, MODEL_ORDER.map((id) => {
      const b = h('button', { style: `--d:${MODEL_RGB[id]}`, 'aria-pressed': 'false', onclick: () => this.setModel(id) }, h('b', {}, h('i'), MODEL_TEXT[id].name), h('small', { text: MODEL_TEXT[id].tag }));
      this.heroPick[id] = b; return b;
    }));
    return h('section', { class: 'hero', 'aria-label': '开场' },
      h('h1', { 'aria-label': HERO.title }, [...HERO.title].map((c, i) => h('span', { style: `--i:${i}`, 'aria-hidden': 'true', text: c }))),
      h('p', { class: 'l1', text: HERO.line1 }),
      h('p', { class: 'l2', text: HERO.line2 }),
      h('div', { class: 'cta' },
        h('button', { class: 'btn solid', onclick: () => this.enter(false) }, HERO.start),
        h('button', { class: 'btn', onclick: () => this.enter(true) }, HERO.ground)),
      pick);
  }

  // --------------------------------------------------------------------- events
  #bind() {
    const app = this.app;
    app.on((kind) => {
      if (kind === 'model') this.refreshModel();
      if (kind === 'state' || kind === 'zoom') { this.refreshSpeed(); }
    });
    addEventListener('resize', () => { this.layoutLens(); this.ruler.layout(); this.closePop(); this.layoutView(); });
    addEventListener('keydown', (ev) => {
      const tg = ev.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k >= '1' && k <= '4') this.setModel(MODEL_ORDER[+k - 1]);
      else if (k === 'j') app.journeyTo(app.S.zoomTarget > 0.5 ? 0 : 1, 3.4);
      else if (k === 'h') this.setClean(!document.body.classList.contains('clean'));
      else if (k === 'l') { app.set({ labels: !app.S.labels }); this.save(); }
      else if (k === 'g') { app.set({ guide: !app.S.guide }); this.save(); this.refreshGuide(); }
      else if (k === 's') this.screenshot();
      else if (k === 'p') this.photo?.toggle();
      else if (k === 'escape') { this.closePop(); if (document.body.classList.contains('clean')) this.setClean(false); }
    });
    document.addEventListener('pointerdown', (ev) => {
      if (!this.pop) return;
      if (ev.target.closest('.pop') || ev.target.closest('.place') || ev.target.closest('.tools')) return;
      this.closePop();
    });
  }

  setModel(id) {
    if (this.photo?.active) this.photo.exit();
    if (this.app.S.model === id) return;
    this.veil.classList.add('on');
    this.app.set({ model: id });
    requestAnimationFrame(() => requestAnimationFrame(() => this.veil.classList.remove('on')));
    this.toast(MODEL_TEXT[id].name);
  }

  enter(ground) {
    const app = this.app;
    this.hero?.classList.add('gone');
    document.body.classList.add('entered');
    if (ground) app.journeyTo(1, 3.6); else app.journeyTo(1, 22);
    if (this.opts.sheet) this.sheet.classList.remove('closed');
    this.layoutView();
  }

  setClean(on) { document.body.classList.toggle('clean', on); this.closePop(); }
  fullscreen() { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (e) { /* denied */ } }
  toggleSheet() { this.opts.sheet = !this.opts.sheet; this.sheet.classList.toggle('closed', !this.opts.sheet); this._ground = this.app.S.zoom > 0.9; this.btnSheet.classList.toggle('on', this.opts.sheet); this.layoutView(); }
  // push the model away from whatever covers the left of the screen
  layoutView() {
    const W = innerWidth, heroUp = this.hero && !this.hero.classList.contains('gone');
    this.app.viewShiftTarget = W <= 900 ? 0 : heroUp ? W * 0.17 : this.opts.sheet ? Math.min(W * 0.16, 200) : 0;
  }

  toast(text) {
    this.root.querySelector('.toast')?.remove();
    const t = h('div', { class: 'toast', role: 'status', text }); this.root.append(t);
    setTimeout(() => t.remove(), 2700);
  }

  // ------------------------------------------------------------- model / sheet
  refreshModel(first) {
    const app = this.app, id = app.S.model, m = app.model, tx = MODEL_TEXT[id];
    document.documentElement.dataset.model = id;
    for (const k in this.switchBtns) this.switchBtns[k].setAttribute('aria-selected', String(k === id));
    if (this.heroPick) for (const k in this.heroPick) this.heroPick[k].setAttribute('aria-pressed', String(k === id));
    this.layoutLens();
    this.sheet.classList.toggle('closed', !this.opts.sheet || (!!this.hero && !document.body.classList.contains('entered') && !first ? true : !this.opts.sheet));
    if (this.hero && !document.body.classList.contains('entered')) this.sheet.classList.add('closed');
    this.btnSheet.classList.toggle('on', this.opts.sheet);
    this.layoutView();
    // sheet content
    const params = h('div', { class: 'params' }, (m.options || []).map((o) => this.#option(m, o)));
    this.sheet.replaceChildren(...[
      h('h2', { text: tx.name }), h('p', { class: 'tag', text: tx.tag }), h('p', { class: 'gist', text: tx.gist }),
      h('ul', {}, tx.claims.map((c) => h('li', { text: c }))),
      h('p', { class: 'watch', text: tx.watch }),
      (m.options || []).length ? h('div', {}, h('p', { class: 'tag', text: T.params }), params) : null,
      (this.lum ??= new LumChart(this.app)).el,
      this.#magBlock()].filter(Boolean));
    this.lum.refresh();
    this.sheet.scrollTop = 0;
    this.ledgerRows.clear(); this.ledgerBody.replaceChildren(); this.ledgerMoreBody.replaceChildren();
    this._ledgerT = 0;
    this._arrived = false;
  }

  // the magnetism section of the sheet: live numbers for this place, and what this cosmology has to say about the poles
  #magBlock() {
    const row = (k) => { const v = h('b'); const el = h('div', { class: 'mrow' }, h('span', { text: k }), v); return { el, v }; };
    this.mg = { decl: row('磁偏角'), incl: row('磁倾角'), f: row('地磁场强度'), n: row('磁北极'), s: row('磁南极'), dn: row('距磁北极') };
    this.mgText = h('p', { class: 'mtext' }); this.mgNote = h('p', { class: 'mnote', text: MAG_COMMON });
    this._magKey = '';
    return h('div', { class: 'magblock' }, h('p', { class: 'tag', text: '地磁 · 磁极' }),
      h('div', { class: 'mrows' }, Object.values(this.mg).map((r) => r.el)), this.mgText, this.mgNote,
      h('p', { class: 'msrc', text: '数据：NOAA 世界磁场模型 WMM2025（真实）' }));
  }
  updateMag() {
    const fx = this.app.model.fx, cp = fx?.compass, st = fx?.state; if (!cp || !st || !this.mg) return;
    const S = this.app.S, key = `${S.model}|${cp.decl.toFixed(2)}|${st.dipN.lat.toFixed(2)}|${st.dipN.lon.toFixed(2)}`;
    if (key === this._magKey) return; this._magKey = key;
    const ll = (p) => `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;
    const m = this.mg;
    m.decl.v.textContent = `${cp.decl < 0 ? '西偏' : '东偏'} ${Math.abs(cp.decl).toFixed(1)}°`;
    m.incl.v.textContent = `${cp.incl >= 0 ? '下倾' : '上翘'} ${Math.abs(cp.incl).toFixed(1)}°`;
    m.f.v.textContent = `${(cp.F / 1000).toFixed(1)} μT`;
    m.n.v.textContent = ll(st.dipN); m.s.v.textContent = ll(st.dipS);
    m.dn.v.textContent = `${Math.round(cp.toN.dist * 111.19).toLocaleString('en-US')} km · 方位 ${Math.round(cp.toN.az)}°`;
    this.mgText.textContent = MAG_TEXT[S.model](st, { drift: fx.poleDrift() });
  }

  #option(m, o) {
    const val = () => m.params[o.key];
    if (o.type === 'bool') {
      const sw = h('button', { class: 'sw', role: 'switch', 'aria-checked': String(!!val()), 'aria-label': o.label, onclick: () => { m.params[o.key] = !m.params[o.key]; sw.setAttribute('aria-checked', String(!!m.params[o.key])); this.app.emit('state'); } });
      return h('div', { class: 'param' }, h('label', { text: o.label }), sw, o.hint ? h('small', { text: o.hint }) : null);
    }
    const out = h('span', { class: 'val' }), inp = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label, style: 'grid-column: 1 / -1' });
    const sync = () => { out.textContent = String(+(+val()).toFixed(2)); inp.style.setProperty('--p', ((val() - o.min) / (o.max - o.min)) * 100 + '%'); };
    inp.value = val(); sync();
    inp.addEventListener('input', () => { m.params[o.key] = +inp.value; sync(); this.app.emit('state'); });
    return h('div', { class: 'param' }, h('label', { text: o.label }), out, inp);
  }

  layoutLens() {
    const b = this.switchBtns[this.app.S.model]; if (!b || !b.offsetWidth) return;
    this.lens.style.width = b.offsetWidth + 'px'; this.lens.style.transform = `translateX(${b.offsetLeft}px)`;
  }

  // ----------------------------------------------------------------- place / time
  setPlace(p) {
    this.place = { name: p.name, tz: p.tz }; this.app.tz = p.tz;
    this.app.set({ lat: p.lat, lon: p.lon, site: p.elev ?? this.app.S.site });
    this.refreshPlace(); if (this.autoTime) this.goBest('place'); this.refreshTime(true); this.save();
    if (Math.abs(p.lat) > 89) this.toast(p.lat > 0 ? '北极点：四面八方都是南方，北极星几乎就在头顶' : '南极点：四面八方都是北方，天空每天绕头顶转一圈');
  }
  setHeight(m) {
    this.app.set({ height: m }); this.refreshPlace(); this.save();
    this.toast(m ? `升到离地 ${m >= 1000 ? m / 1000 + ' 千米' : m + ' 米'}` : '回到地面');
  }
  refreshPlace() {
    const S = this.app.S;
    const up = S.height > 0 ? ` · 离地 ${S.height >= 1000 ? +(S.height / 1000).toFixed(1) + ' km' : S.height + ' m'}` : '';
    this.placeBtn.replaceChildren(icon('pin'), h('span', { text: this.place.name }), h('small', { text: `${fmtLat(S.lat)} ${fmtLon(S.lon)} · 海拔 ${Math.round(S.site)} m${up}` }));
  }
  get tz() { return this.place.tz; }

  setRate(r) { this.app.S.rate = r; this.app.S.playing = true; this.app.emit('state'); this.refreshSpeed(); }
  refreshSpeed() {
    const S = this.app.S, a = Math.abs(S.rate);
    this.speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i].rate === a)));
    this.rev.setAttribute('aria-pressed', String(S.rate < 0));
    this.pp.replaceChildren(icon(S.playing ? 'pause' : 'play'));
    this.pp.title = S.playing ? T.pause + ' (空格)' : T.play + ' (空格)';
  }
  goNow() { this.autoTime = false; this.app.S.jd = jdFromDate(new Date()); this.app.S.rate = 1; this.app.S.playing = true; this.app.emit('state'); this.refreshSpeed(); this.refreshTime(true); }
  refreshGuide() { this.btnGuide.setAttribute('aria-pressed', String(!!this.app.S.guide)); }
  // Default time of the whole site: the best moment of the coming night at this place.
  goBest(mode) {
    const app = this.app, S = app.S;
    const anchor = mode === 'initial' ? jdFromDate(new Date()) : S.jd;
    this.eph2 ??= new Ephemeris();
    let n = sampleNight(this.eph2, S.lat, S.lon, this.tz, anchor, true), note = '';
    if (n.sunMin > -18) {                       // no astronomical night here tonight: midnight Sun, white nights, or the twilight season at the poles
      const why = { day: '太阳整夜不落（极昼）', twilight: '整夜都有暮光（白夜），太阳不够低', 'twilight-polar': '太阳在地平线下，但始终高于 −18°（极夜里的暮光季）' }[n.kind];
      const nx = nextDarkNight(this.eph2, S.lat, S.lon, this.tz, anchor);
      if (nx) {
        n = nx.n;
        const zz = zoned(dateFromJd(n.t0 + 0.2).getTime(), this.tz);
        note = `${this.place.name}此刻${why}，没有天文夜。已跳到 ${zz.mo} 月 ${zz.d} 日：这里下一个真正黑下来的夜晚`;
      } else note = `${this.place.name}${why}，一年之内都没有天文夜`;
    } else if (n.kind === 'polarnight') note = `${this.place.name}正处在极夜：太阳整天都在地平线下，整个“白天”也是夜空`;
    const jd = bestMoment(n);
    this.bestJd = jd; this.autoTime = true; this.nightKind = n.kind;
    S.jd = jd; S.rate = 1; S.playing = true;
    if (mode === 'button') {
      app.emit('state'); this.refreshSpeed(); this.refreshTime(true);
      const z = zoned(dateFromJd(jd).getTime(), this.tz); this.toast(note || `最佳观星时刻 ${pad(z.h)}:${pad(z.mi)}`);
    } else if (note) { app.emit('state'); this.refreshTime(true); setTimeout(() => this.toast(note), mode === 'initial' ? 1500 : 0); }
  }
  pickTime() {
    const v = this.clockIn.value; if (!v) return;
    this.autoTime = false;
    const [d, t] = v.split('T'), [y, mo, da] = d.split('-').map(Number), [hh, mi] = t.split(':').map(Number);
    this.app.S.jd = jdFromDate(new Date(fromZoned(y, mo, da, hh, mi, this.tz)));
    this.app.emit('state'); this.refreshTime(true);
  }
  refreshTime(force) {
    const S = this.app.S, ts = dateFromJd(S.jd).getTime(), z = zoned(ts, this.tz);
    const slow = Math.abs(S.rate) <= 600, best = this.bestJd !== undefined && Math.abs(S.jd - this.bestJd) < 12 / 1440;
    const sig = `${z.y}${z.mo}${z.d}${z.h}${z.mi}${z.s}|${this.tz}|${Math.round(S.lat)}|${slow}|${best}`;
    if (!force && sig === this._lastClock) return;
    this._lastClock = sig;
    const alt = this.app.cond.sunAlt;
    const sky = !slow ? '时间飞逝' : best ? '最佳观星时刻' : alt > 0 ? '白天' : alt > -6 ? '民用晨昏' : alt > -12 ? '航海晨昏' : alt > -18 ? '天文晨昏' : '天文夜';
    const txt = `${z.y}-${pad(z.mo)}-${pad(z.d)} ${pad(z.h)}:${pad(z.mi)}:${pad(z.s)}`;
    for (let i = 0; i < 19; i++) { const c = this.clockCh[i], ch = txt[i]; if (c.textContent !== ch) { c.textContent = ch; c.className = ch >= '0' && ch <= '9' ? 'd' : ''; } }
    this.clockS.textContent = `${z.wd} · ${offsetLabel(z.off)} · ${sky}`;
    this.clockS.classList.toggle('best', best && slow);
    if (document.activeElement !== this.clockIn) this.clockIn.value = `${z.y}-${pad(z.mo)}-${pad(z.d)}T${pad(z.h)}:${pad(z.mi)}`;
  }

  // ---------------------------------------------------------------- pop-overs
  closePop() { if (this.pop) { this.pop.el.remove(); this.pop.btn.classList.remove('on'); this.pop = null; } }
  togglePop(kind, btn) {
    if (this.pop && this.pop.kind === kind) { this.closePop(); return; }
    this.closePop();
    const el = kind === 'place' ? this.#placePop() : this.#layersPop();
    this.root.append(el);
    const r = btn.getBoundingClientRect(), W = innerWidth, w = el.offsetWidth || 330;
    if (kind === 'place') { el.style.left = clamp(r.left, 10, W - w - 10) + 'px'; el.style.bottom = innerHeight - r.top + 10 + 'px'; }
    else { el.style.right = clamp(W - r.right, 10, W - w - 10) + 'px'; el.style.top = r.bottom + 10 + 'px'; el.style.transformOrigin = 'top right'; }
    btn.classList.add('on'); this.pop = { kind, el, btn };
  }

  #chip(text, pressed, fn) { const b = h('button', { class: 'chip', 'aria-pressed': String(!!pressed), onclick: (e) => { fn(b); } }, text); return b; }
  #range(label, min, max, step, get, set, fmt = (v) => String(v)) {
    const out = h('span', { class: 'val' }), inp = h('input', { type: 'range', min, max, step, 'aria-label': label, style: 'grid-column: 1 / -1' });
    const sync = () => { out.textContent = fmt(+inp.value); inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%'); };
    inp.value = get(); sync();
    inp.addEventListener('input', () => { set(+inp.value); sync(); this.save(); });
    return h('div', { class: 'param' }, h('label', { text: label }), out, inp);
  }

  #placePop() {
    const app = this.app, S = app.S;
    const chips = PLACES.map((p) => this.#chip(p.name, p.name === this.place.name, () => { this.setPlace(p); this.closePop(); this.toast(`观测地：${p.name}`); }));
    const lat = h('input', { type: 'number', step: '0.01', min: '-90', max: '90', value: S.lat.toFixed(2), 'aria-label': '纬度' });
    const lon = h('input', { type: 'number', step: '0.01', min: '-180', max: '180', value: S.lon.toFixed(2), 'aria-label': '经度' });
    const elev = h('input', { type: 'number', step: '10', min: '-400', max: '8900', value: String(Math.round(S.site)), 'aria-label': '海拔（米）' });
    const go = () => {
      const la = clamp(parseFloat(lat.value), -90, 90), lo = clamp(parseFloat(lon.value), -180, 180), el = clamp(parseFloat(elev.value) || 0, -400, 8900);
      if (!isFinite(la) || !isFinite(lo)) { this.toast('请输入有效的经纬度'); return; }
      this.setPlace({ name: '自定义', lat: la, lon: lo, tz: Math.round(lo / 15), elev: el }); this.closePop(); this.toast(`观测地：${fmtLat(la)} ${fmtLon(lo)} · 海拔 ${Math.round(el)} m`);
    };
    for (const i of [lat, lon, elev]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const hts = HEIGHTS.map((o) => this.#chip(o.name, S.height === o.m, () => { this.setHeight(o.m); [...hrow.children].forEach((c, i) => c.setAttribute('aria-pressed', String(HEIGHTS[i].m === o.m))); }));
    hts.forEach((b, i) => { b.title = HEIGHTS[i].hint; });
    const hrow = h('div', { class: 'row' }, hts);
    const geo = h('button', { class: 'chip', onclick: () => {
      if (!navigator.geolocation) { this.toast('此浏览器不能定位'); return; }
      navigator.geolocation.getCurrentPosition((p) => { this.setPlace({ name: '我的位置', lat: p.coords.latitude, lon: p.coords.longitude, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); this.closePop(); },
        () => this.toast('没有拿到位置，请手动输入'), { timeout: 8000 });
    } }, '使用我的位置');
    return h('div', { class: 'pop', role: 'dialog', 'aria-label': T.observer },
      h('h4', { text: T.observer }), h('div', { class: 'row' }, chips),
      h('div', { class: 'field' }, h('label', {}, '纬度', lat), h('label', {}, '经度', lon), h('label', {}, '海拔 (m)', elev), h('button', { class: 'btn solid', style: 'align-self:end', onclick: go }, '前往')),
      h('div', { class: 'sep' }), h('h4', { class: 'sub', text: '离地高度' }), hrow,
      h('p', { class: 'note', text: '升高后空气变薄、地平线下沉（曲面大地），平地说里它始终与眼睛齐平。' }),
      h('div', { class: 'sep' }), h('div', { class: 'row' }, geo));
  }

  #layersPop() {
    const app = this.app, S = app.S;
    const seg = h('div', { class: 'seg' }, [['none', '无'], ['west', '西方星座'], ['cn', '中国星官']].map(([v, t]) =>
      h('button', { 'aria-pressed': String(S.lines === v), onclick: () => { app.set({ lines: v }); this.save(); [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === v))); }, 'data-v': v }, t)));
    const tg = (label, key) => this.#chip(label, S[key], (b) => { app.set({ [key]: !S[key] }); b.setAttribute('aria-pressed', String(!!S[key])); this.save(); });
    return h('div', { class: 'pop', role: 'dialog', 'aria-label': T.layers },
      h('h4', { text: '星座连线' }), seg, h('div', { class: 'sep' }),
      h('div', { class: 'row' }, tg('名称标注', 'labels'), tg('深空天体', 'dso'), tg('天赤道', 'equator'), tg('黄道', 'ecliptic'), tg('经纬网', 'grid')),
      h('div', { class: 'sep' }),
      this.#range('银河亮度', 0, 1.6, 0.05, () => S.mw, (v) => app.set({ mw: v }), (v) => v.toFixed(2)),
      this.#range('光污染（波特尔级）', 1, 9, 1, () => S.bortle, (v) => app.set({ bortle: v }), (v) => `${v} 级`),
      this.#range('山脊', 0, 1, 0.05, () => S.ridges, (v) => app.set({ ridges: v }), (v) => v.toFixed(2)),
      this.#range('星轨（天球转过的角度）', 0, 120, 1, () => S.trails, (v) => app.set({ trails: v }), (v) => (v ? `${v}°` : '关')),
      h('div', { class: 'sep' }),
      h('h4', { class: 'sub', text: '日月运行' }),
      h('div', { class: 'row' }, tg('日月轨迹', 'paths'), tg('四季日轨', 'arcs'), tg('日月拖尾', 'lumTrail')),
      h('p', { class: 'note', text: '日月轨迹：地面视角下今天太阳（金）与月亮（蓝）按这个宇宙观走过的路，每两小时一个刻度；若与真实天空相差超过 1°，真实的路径会以白色虚线叠在下面。拖尾：掌上视图里，时间播放时日月留下的尾迹。' }),
      h('div', { class: 'sep' }),
      h('h4', { class: 'sub', text: '天象与地磁' }),
      h('div', { class: 'row' }, tg('极光', 'aurora'), tg('流星', 'meteors'), tg('卫星', 'sats'), tg('磁极与磁力线', 'mag')),
      this.#range('极光活动（Kp 指数）', 0, 9, 0.5, () => S.kp, (v) => app.set({ kp: v }), (v) => `Kp ${v}`),
      this.#range('流星频率（真实频率 ×）', 1, 60, 1, () => S.meteorBoost, (v) => app.set({ meteorBoost: v }), (v) => `×${v}`),
      h('p', { class: 'note', text: this.#skyNote() }),
      h('div', { class: 'sep' }),
      this.#chip('截图附说明条', this.opts.caption, (b) => { this.opts.caption = !this.opts.caption; b.setAttribute('aria-pressed', String(this.opts.caption)); this.save(); }));
  }

  #skyNote() {
    const act = activeShowers(this.app.S.jd), top = act[0];
    return (top ? `此刻活跃的流星雨：${top.zh}（峰值每小时约 ${Math.round(top.zhr)} 颗，今天约 ${Math.round(top.zhrNow)}）。` : '这几天没有大的流星雨，只有零星流星。')
      + '极光 Kp 与卫星轨道是示意：真实的 Kp 和卫星位置需要联网数据，这里可手调；磁极位置与磁偏角是真实的。';
  }

  // ----------------------------------------------------------------- screenshot
  async screenshot() {
    const app = this.app, S = app.S;
    app.tick(0);
    const src = app.canvas, k = src.width / innerWidth, R = this.photo?.cropRect();
    const sx = R ? Math.round(R.x * k) : 0, sy = R ? Math.round(R.y * k) : 0, W = R ? Math.round(R.w * k) : src.width, H = R ? Math.round(R.h * k) : src.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(src, sx, sy, W, H, 0, 0, W, H);
    const pc = this.labels.cv; if (pc && S.paths && S.zoom > 0.8) { const q = pc.width / src.width; g.drawImage(pc, sx * q, sy * q, W * q, H * q, 0, 0, W, H); }
    const z = zoned(dateFromJd(S.jd).getTime(), this.tz);
    const stamp = `${z.y}${pad(z.mo)}${pad(z.d)}-${pad(z.h)}${pad(z.mi)}`;
    if (this.opts.caption) {
      try { await Promise.all([document.fonts.load('900 20px Display', BRAND), document.fonts.load('500 14px Bricolage', '0')]); } catch (e) { /* fall back */ }
      const u = Math.min(W, H * 1.6) / 1440, bh = Math.round(86 * u);
      const gr = g.createLinearGradient(0, H - bh * 1.6, 0, H); gr.addColorStop(0, 'rgba(4,6,18,0)'); gr.addColorStop(1, 'rgba(4,6,18,.82)');
      g.fillStyle = gr; g.fillRect(0, H - bh * 1.6, W, bh * 1.6);
      const pad0 = Math.round(26 * u), tx = MODEL_TEXT[S.model];
      g.textBaseline = 'alphabetic'; g.fillStyle = '#f2f4ff';
      g.font = `900 ${Math.round(24 * u)}px Display, 'Noto Serif CJK SC', serif`; g.fillText(`${BRAND} · ${tx.name}`, pad0, H - pad0 - Math.round(24 * u));
      g.fillStyle = 'rgba(214,220,255,.86)'; g.font = `500 ${Math.round(14.5 * u)}px Bricolage, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
      const view = S.zoom > 0.84 ? `方位 ${Math.round(S.az)}° 高度 ${Math.round(S.alt)}° 视场 ${Math.round(S.fov)}°` : '';
      const line = `${this.place.name} ${fmtLat(S.lat)} ${fmtLon(S.lon)} · ${z.y}-${pad(z.mo)}-${pad(z.d)} ${pad(z.h)}:${pad(z.mi)} ${offsetLabel(z.off)}${view ? ' · ' + view : ''}`;
      g.fillText(line, pad0, H - pad0);
    }
    const name = `cosmos-${S.model}-${stamp}.png`;
    c.toBlob((blob) => {
      if (!blob) { this.toast('截图失败'); return; }
      const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.toast(`已保存 ${name}`);
    }, 'image/png');
  }

  // ------------------------------------------------------------------- per frame
  frame(ctx) {
    const app = this.app, S = app.S;
    this.ruler.update();
    if (app.eyeM !== this._eyeM) { this._eyeM = app.eyeM; clearTimeout(this._rl); this._rl = setTimeout(() => this.ruler.layout(), 250); }
    this.refreshTime(false);
    this.labels.frame(ctx);
    this.photo?.frame();
    const t = performance.now();
    if (t - this._ledgerT > 220) { this._ledgerT = t; this.updateLedger(); this.updateViewInfo(); this.updateMag(); if (this.lum && !this.sheet.classList.contains('closed')) this.lum.update(); }
    // arrival caption: you have been inside it all along
    if (S.zoom > 0.985 && !this._arrived) {
      this._arrived = true; this._flipT = t;
      const tx = FLIP[S.model];
      this.flip.firstChild.textContent = FLIP.head; this.flip.lastChild.textContent = tx;
      this.flip.classList.remove('show'); void this.flip.offsetWidth; this.flip.classList.add('show');
    } else if (S.zoom < 0.9 && this._arrived) { this._arrived = false; this.flip.classList.remove('show'); }
    if (!this.pop) this.btnLayers.classList.remove('on');
    this.btnSheet.classList.toggle('on', !this.sheet.classList.contains('closed'));
    // on the ground the sky is the subject: the sheet steps aside (it can be reopened)
    const ground = S.zoom > 0.9;
    if (ground !== this._ground && !(this.hero && !document.body.classList.contains('entered'))) { this._ground = ground; this.sheet.classList.toggle('closed', ground || !this.opts.sheet); }
  }

  updateViewInfo() {
    const S = this.app.S;
    this.viewinfo.textContent = S.zoom > 0.84 ? `方位 ${Math.round(S.az)}° · 高度 ${Math.round(S.alt)}° · 视场 ${Math.round(S.fov)}°` : '拖动环绕 · 滚轮或下方尺度尺缩放 · 双击落地';
  }

  // ---------------------------------------------------------------------- ledger
  #ledgerRow(r) {
    const nm = h('div', { class: 'nm' }, r.zh, h('em')), mN = h('div', { class: 'num m' }), rN = h('div', { class: 'num r' });
    const gap = h('i', { class: 'gap' }), tr = h('i', { class: 'tr' }), tm = h('i', { class: 'tm' }), ver = h('div', { class: 'verdict' });
    const el = h('div', { class: 'lrow' }, h('div', { class: 'r1' }, nm, mN, rN), h('div', { class: 'gauge' }, gap, tr, tm), ver);
    return { el, nm: nm.lastChild, mN, rN, gap, tr, tm, ver };
  }
  updateLedger() {
    const app = this.app, S = app.S;
    const show = S.zoom > 0.8 && !this.photo?.active && !document.body.classList.contains('clean');
    this.ledger.classList.toggle('off', !show);
    if (!show) return;
    const rows = app.compare(), main = new Set(['horizon', 'polaris', 'galcentre', 'sun', 'moon']);
    const x = (alt) => clamp((alt + 90) / 180, 0, 1) * 96 + 2 + '%';
    for (const r of rows) {
      let L = this.ledgerRows.get(r.key);
      if (!L) { L = this.#ledgerRow(r); this.ledgerRows.set(r.key, L); (main.has(r.key) ? this.ledgerBody : this.ledgerMoreBody).append(L.el); }
      const ok = !!r.model, err = r.err ?? 0;
      const col = !ok ? 'var(--faint)' : err < 0.6 ? 'var(--good)' : err < 4 ? 'var(--warn)' : 'var(--bad)';
      L.el.style.setProperty('--c', col);
      L.mN.textContent = ok ? fmtDeg(r.model.alt) : '—'; L.rN.textContent = fmtDeg(r.real.alt);
      L.nm.textContent = ok && r.key !== 'horizon' ? `方位 ${Math.round(r.model.az)}° · ${Math.round(r.real.az)}°` : '';
      L.tr.style.left = x(r.real.alt);
      L.tm.style.display = L.gap.style.display = ok ? '' : 'none';
      if (ok) {
        L.tm.style.left = x(r.model.alt);
        const a = parseFloat(L.tr.style.left), b = parseFloat(L.tm.style.left);
        L.gap.style.left = Math.min(a, b) + '%'; L.gap.style.width = Math.abs(a - b) + '%';
      }
      L.ver.textContent = r.note ? r.note : !ok ? '这个宇宙观没有它的位置'
        : r.real.alt > 0 && r.model.alt < -1 ? `现实中可见，模型里在地平线下 · 相差 ${err.toFixed(1)}°`
        : r.real.alt < 0 && r.model.alt > 1 ? `现实中在地平线下，模型里却高悬 · 相差 ${err.toFixed(1)}°`
        : err < 0.6 ? `${T.match} · 相差 ${err.toFixed(2)}°` : `相差 ${err.toFixed(1)}°`;
    }
    const m = app.model;
    let foot = T.compareHint;
    const ms = m.moonSize?.();
    if (ms) foot += `。月亮视直径：模型 ${ms.model.toFixed(2)}° · 现实 ${ms.real.toFixed(2)}°`;
    if (this.ledgerFoot.textContent !== foot) this.ledgerFoot.textContent = foot;
  }
}
