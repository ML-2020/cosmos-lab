// Photographer mode.  Always the real sky (the giant-sphere geometry, exact ephemeris), whichever hypothesis was open:
// pick a place, a night, a direction and a lens, read the night off a timeline (twilight, Moon, Milky Way core),
// then preview what the next hours will look like -- as a time-lapse, as star trails, or recorded to WebM.
import { h, icon, pad, clamp, zoned, fromZoned, offsetLabel } from './dom.js';
import { nightBase, sampleNight } from './night.js';
import { Ephemeris, localFrame, lstDeg, dirToHoriz, horizToDir, altAz, jdFromDate, dateFromJd, R2D, D2R } from '../astro.js';

const SENSORS = { ff: ['全画幅', 36, 24], apsc: ['APS-C', 23.5, 15.6], m43: ['M4/3', 17.3, 13], inch1: ['1 英寸', 13.2, 8.8] };
const FOCALS = [14, 20, 24, 35, 50, 85, 135, 200];
const SPANS = [[0.5, '30 分'], [1, '1 时'], [2, '2 时'], [4, '4 时'], [0, '全夜']];
const SIDEREAL = 360.98564736629 / 24;               // degrees of sky rotation per hour
const MINUS = '−';
const NIGHT_COL = [[8, 11, 32], [14, 20, 58], [24, 34, 92], [40, 56, 128], [74, 98, 168]];   // astronomical night ... day

const hhmm = (jd, tz) => { const z = zoned(Math.round(dateFromJd(jd).getTime() / 60000) * 60000, tz); return `${pad(z.h)}:${pad(z.mi)}`; };

export class Photo {
  constructor(app, ui) {
    this.app = app; this.ui = ui; this.active = false;
    this.f = 24; this.sensor = 'ff'; this.track = false; this.span = 2; this.trailMode = 'none'; this.thirds = true;
    this.night = null; this._nightKey = ''; this._sync = 0; this.eph2 = new Ephemeris(); this._fr = {};
    this.#build();
    app.onWheel = (d) => { if (!this.active) return false; this.setFocal(this.f * Math.exp(-d * 0.0016)); return true; };
    app.on((kind) => { if (this.active && (kind === 'state' || kind === 'view')) this._dirty = true; });
    addEventListener('resize', () => { if (this.active) this.applyLens(); });
  }

  // ------------------------------------------------------------------------ DOM
  #build() {
    const app = this.app, S = app.S;
    const sec = (title, ...kids) => h('section', {}, h('h4', { text: title }), ...kids);
    const chip = (text, on, fn) => { const b = h('button', { class: 'chip', 'aria-pressed': String(!!on), onclick: () => fn(b) }, text); return b; };
    this.sl = [];
    const slider = (label, min, max, step, get, set, fmt) => {
      const out = h('span', { class: 'val' }), inp = h('input', { type: 'range', min, max, step, 'aria-label': label, style: 'grid-column: 1 / -1' });
      const sync = () => { inp.value = get(); out.textContent = fmt(+inp.value); inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%'); };
      inp.addEventListener('input', () => { set(+inp.value); out.textContent = fmt(+inp.value); inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%'); });
      sync(); this.sl.push({ inp, sync });
      return h('div', { class: 'param' }, h('label', { text: label }), out, inp);
    };

    // pointing
    this.aim = h('div', { class: 'row' });
    this.aimChips = [['polaris', '北极星'], ['galcentre', '银河中心'], ['moon', '月亮'], ['sun', '太阳']].map(([k, t]) => chip(t, false, () => this.pointAt(k)));
    for (const [t, az] of [['正北', 0], ['正东', 90], ['正南', 180], ['正西', 270]]) this.aimChips.push(chip(t, false, () => { this.look(az, S.alt); }));
    this.aim.append(...this.aimChips);
    this.trackSw = h('button', { class: 'sw', role: 'switch', 'aria-checked': 'false', 'aria-label': '赤道仪跟踪', onclick: () => { this.track = !this.track; this.trackSw.setAttribute('aria-checked', String(this.track)); this.captureTrack(); } });

    // lens
    this.sensorSeg = h('div', { class: 'seg' }, Object.entries(SENSORS).map(([k, v]) => h('button', { 'data-k': k, 'aria-pressed': String(k === this.sensor), onclick: () => { this.sensor = k; this.applyLens(); } }, v[0])));
    this.focalChips = FOCALS.map((f) => chip(`${f}`, f === this.f, () => this.setFocal(f)));
    this.fovOut = h('p', { class: 'foot' });

    // night
    this.tl = h('canvas', { class: 'tl', width: 600, height: 150, 'aria-label': '夜晚时间轴' });
    this.nightInfo = h('div', { class: 'ninfo' });
    this.#bindTimeline();

    // preview
    this.spanSeg = h('div', { class: 'seg' }, SPANS.map(([v, t]) => h('button', { 'data-v': v, 'aria-pressed': String(v === this.span), onclick: () => { this.span = v; this.refreshSpan(); } }, t)));
    this.trailSeg = h('div', { class: 'seg' }, [['none', '无星轨'], ['ahead', '前瞻星轨'], ['grow', '渐长星轨']].map(([v, t]) => h('button', { 'data-v': v, 'aria-pressed': String(v === this.trailMode), onclick: () => { this.trailMode = v; this.refreshTrails(); } }, t)));
    this.playBtn = h('button', { class: 'btn solid', onclick: () => (this.run ? this.stopPreview(true) : this.preview(false)) }, icon('play'), '预演延时');
    this.recBtn = h('button', { class: 'btn', title: '预演的同时录制为 WebM 视频', onclick: () => this.preview(true) }, '录制 WebM');
    this.bar = h('div', { class: 'pbar' }, h('i'));
    this.shotBtn = h('button', { class: 'btn', onclick: () => this.ui.screenshot() }, icon('shot'), '保存取景 PNG');

    this.panel = h('aside', { class: 'photo off', 'aria-label': '摄影师' },
      h('h3', {}, '摄影师', h('button', { class: 'btn icon', 'aria-label': '关闭', onclick: () => this.toggle() }, icon('close'))),
      h('p', { class: 'foot' }, '固定使用真实天文，与所选宇宙观无关。地点和时刻在下方的地点、时间栏里设。'),
      sec('取景方向', this.aim,
        slider('方位', 0, 360, 0.5, () => S.az, (v) => { S.az = v % 360; this.captureTrack(); app.emit('view'); }, (v) => `${Math.round(v)}°`),
        slider('高度', -10, 90, 0.5, () => S.alt, (v) => { S.alt = v; this.captureTrack(); app.emit('view'); }, (v) => (v < 0 ? MINUS : '') + Math.abs(Math.round(v)) + '°'),
        h('div', { class: 'param' }, h('label', { text: '赤道仪跟踪' }), this.trackSw, h('small', { text: '开：画面跟着星空转（深空摄影）；关：三脚架固定，星星划过画面' }))),
      sec('镜头', this.sensorSeg, h('div', { class: 'row', style: 'margin-top:10px' }, this.focalChips),
        slider('焦距', 0, 1, 0.001, () => this.focalToT(this.f), (t) => this.setFocal(this.tToFocal(t), true), () => `${Math.round(this.f)} mm`), this.fovOut),
      sec('这一夜', this.tl, this.nightInfo,
        slider('光污染（波特尔级）', 1, 9, 1, () => S.bortle, (v) => app.set({ bortle: v }), (v) => `${v} 级`)),
      sec('延时预演', h('p', { class: 'foot', style: 'margin:0 0 8px' }, '从当前时刻开始，向后推演：'), this.spanSeg, h('div', { style: 'height:8px' }), this.trailSeg,
        h('div', { class: 'row', style: 'margin-top:12px' }, this.playBtn, this.recBtn), this.bar),
      h('div', { class: 'row', style: 'margin-top:14px' }, this.shotBtn));

    this.frameEl = h('div', { class: 'pframe', hidden: true }, h('b'), h('i', { class: 'g1' }), h('i', { class: 'g2' }), h('i', { class: 'g3' }), h('i', { class: 'g4' }));
    this.ui.root.append(this.frameEl, this.panel);
  }

  #bindTimeline() {
    const set = (ev) => {
      if (!this.night) return;
      const r = this.tl.getBoundingClientRect(), t = clamp((ev.clientX - r.left) / r.width, 0, 1);
      const S = this.app.S; this.ui.autoTime = false; S.jd = this.night.t0 + t * this.night.len; S.playing = false; S.rate = 1; this.stopPreview(false);
      this.app.emit('state'); this.ui.refreshSpeed(); this.ui.refreshTime(true); this._dirty = true;
    };
    this.tl.addEventListener('pointerdown', (ev) => { this.tl.setPointerCapture(ev.pointerId); this._tld = true; set(ev); });
    this.tl.addEventListener('pointermove', (ev) => { if (this._tld) set(ev); });
    this.tl.addEventListener('pointerup', () => { this._tld = false; });
  }

  // ------------------------------------------------------------------ mode switch
  toggle() { this.active ? this.exit() : this.enter(); }
  enter() {
    const app = this.app, S = app.S;
    this.prev = { model: S.model, fov: S.fov, trails: S.trails, rate: S.rate, playing: S.playing, labels: S.labels };
    app._journey = null; S.autorotate = false;
    if (S.model !== 'globe') app.set({ model: 'globe' });
    if (S.zoom < 0.9) app.journeyTo(1, 2.4); else app.set({ zoomTarget: 1 });
    S.playing = false; S.rate = 1; S.trails = 0;
    this.active = true; this._dirty = true; this._night = '';
    document.body.classList.add('photomode');
    this.panel.classList.remove('off'); this.frameEl.hidden = false; this.ui.btnPhoto.classList.add('on');
    this.ui.ledger.classList.add('off'); this.ui.refreshSpeed();
    this.applyLens(); this.captureTrack(); this.refreshTrails();
    this.ui.toast('摄影师模式 · 真实天文');
  }
  exit() {
    const app = this.app, S = app.S, p = this.prev || {};
    this.stopPreview(false);
    this.active = false; document.body.classList.remove('photomode');
    this.panel.classList.add('off'); this.frameEl.hidden = true; this.ui.btnPhoto.classList.remove('on');
    app.viewShiftGround = 0;
    S.trails = p.trails ?? 0; S.fov = p.fov ?? 75; S.rate = p.rate ?? 1; S.playing = p.playing ?? true; S.autorotate = true;
    app.model.sky && (app.model.sky.u.uTrailFade.value = 0);
    if (p.model && p.model !== S.model) app.set({ model: p.model }); else app.emit('state');
    this.ui.refreshSpeed();
  }

  // ------------------------------------------------------------------- lens
  focalToT(f) { return (Math.log(f) - Math.log(8)) / (Math.log(600) - Math.log(8)); }
  tToFocal(t) { return Math.exp(Math.log(8) + t * (Math.log(600) - Math.log(8))); }
  setFocal(f, fromSlider) {
    this.f = clamp(f, 8, 600);
    this.applyLens();
    for (const c of this.focalChips) c.setAttribute('aria-pressed', String(Math.abs(+c.textContent - this.f) < 0.5));
    if (!fromSlider) this.sl.forEach((s) => s.sync());
  }
  // Rectilinear lens: the 3:2 (or 4:3, ...) frame fills `fh` of the window height; the camera's own FOV is set so that
  // the frame subtends exactly the lens's field of view.
  applyLens() {
    const [name, sw, sh] = SENSORS[this.sensor], f = this.f, asp = sw / sh, W = innerWidth, H = innerHeight;
    const fv = 2 * Math.atan(sh / (2 * f)), fhz = 2 * Math.atan(sw / (2 * f));
    const side = W > 900 ? -190 : 0, availW = W - (W > 900 ? 396 : 0) - 48;      // the frame sits left of the panel
    this.app.viewShiftGround = side;
    let fh = H * 0.78, fw = fh * asp;
    if (fw > availW) { fw = availW; fh = fw / asp; }
    let cam = 2 * Math.atan(Math.tan(fv / 2) * H / fh);
    if (cam > 110 * D2R) { cam = 110 * D2R; fh = Math.tan(fv / 2) * H / Math.tan(cam / 2); fw = Math.min(fh * asp, availW); }
    this.app.S.fov = cam * R2D; this.rect = { x: (W + side - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    const st = this.frameEl.style; st.left = this.rect.x + 'px'; st.top = this.rect.y + 'px'; st.width = fw + 'px'; st.height = fh + 'px';
    this.frameEl.classList.toggle('thirds', this.thirds);
    this.frameEl.firstChild.textContent = `${Math.round(f)} mm · ${name} · ${(fhz * R2D).toFixed(1)}° × ${(fv * R2D).toFixed(1)}°`;
    this.fovOut.textContent = `视场 ${(fhz * R2D).toFixed(1)}° × ${(fv * R2D).toFixed(1)}°，对角 ${(2 * Math.atan(Math.hypot(sw, sh) / (2 * f)) * R2D).toFixed(1)}°`;
    for (const b of this.sensorSeg.children) b.setAttribute('aria-pressed', String(b.dataset.k === this.sensor));
    this.app.emit('view');
  }
  cropRect() { return this.active ? this.rect : null; }

  // ------------------------------------------------------------------ pointing
  look(az, alt) {
    const S = this.app.S; S.az = ((az % 360) + 360) % 360; S.alt = clamp(alt, -10, 89.5); this.captureTrack(); this.app.emit('view'); this.sl.forEach((s) => s.sync());
  }
  pointAt(key) {
    const row = this.app.compare().find((r) => r.key === key); if (!row) return;
    if (row.real.alt < -8) { this.ui.toast(`${row.key === 'galcentre' ? '银河中心' : row.key === 'polaris' ? '北极星' : row.key === 'moon' ? '月亮' : '太阳'}此刻在地平线下 ${Math.round(-row.real.alt)}°`); }
    this.look(row.real.az, Math.max(row.real.alt, -8));
  }
  captureTrack() {
    const S = this.app.S; if (!this.track) return;
    this._trackDir = horizToDir(S.az, S.alt, localFrame(S.lat, lstDeg(S.jd, S.lon), this._fr), this._trackDir);
  }

  // ------------------------------------------------------------------- trails
  refreshSpan() { for (const b of this.spanSeg.children) b.setAttribute('aria-pressed', String(+b.dataset.v === this.span)); this.refreshTrails(); }
  spanHours() {
    if (this.span > 0) return this.span;
    const n = this.night; if (!n || n.nightStart === null) return 8;
    return Math.max(1, (n.nightEnd - Math.max(this.app.S.jd, n.nightStart)) * 24);
  }
  refreshTrails() {
    const S = this.app.S, u = this.app.model.sky?.u;
    for (const b of this.trailSeg.children) b.setAttribute('aria-pressed', String(b.dataset.v === this.trailMode));
    if (u) u.uTrailFade.value = this.trailMode === 'ahead' ? 0.7 : 0;
    if (this.trailMode === 'ahead') S.trails = -Math.min(170, this.spanHours() * SIDEREAL);
    else if (this.trailMode === 'none') S.trails = 0;
    this.app.emit('state');
  }

  // ----------------------------------------------------------------- the night
  computeNight() {
    const S = this.app.S, tz = this.ui.tz;
    const base = nightBase(S.jd, tz);
    const key = `${Math.round(S.lat * 10)},${Math.round(S.lon * 10)},${base},${tz}`;
    if (key === this._night) return; this._night = key;
    const { t0, len, N, sun, moon, gc, frac, kind } = sampleNight(this.eph2, S.lat, S.lon, tz, S.jd);
    const cross = (arr, thr, below) => {            // first run with arr < thr (below) or > thr: [start jd, end jd, startsOpen, endsOpen]
      const on = (i) => (below ? arr[i] < thr : arr[i] > thr);
      const at = (i) => i - 1 + (thr - arr[i - 1]) / (arr[i] - arr[i - 1]);
      let i = 0; while (i < N && !on(i)) i++;
      if (i >= N) return null;
      const s0 = i === 0 ? 0 : at(i);
      let j = i; while (j < N && on(j)) j++;
      const e0 = j >= N ? N - 1 : at(j), J = (x) => t0 + (x / (N - 1)) * len;
      return [J(s0), J(e0), i === 0, j >= N];
    };
    const night = cross(sun, -18, true), dark = cross(sun, -12, true);
    const moonUp = cross(moon, 0, false), core = cross(gc, 10, false);
    let gcMax = -99, gcAt = 0; for (let i = 0; i < N; i++) if (gc[i] > gcMax && sun[i] < -12) { gcMax = gc[i]; gcAt = i; }
    this.night = { t0, len, sun, moon, gc, N, nightStart: night ? night[0] : null, nightEnd: night ? night[1] : null, frac };
    // words
    const lines = [];
    if (kind === 'polarnight') lines.push(['天文夜', '极夜：这一整段时间太阳都在地平线以下，并且低于 −18°']);
    else if (night) lines.push(['天文夜', `${night[2] ? '日落后全程' : hhmm(night[0], tz)} – ${night[3] ? '直到清晨' : hhmm(night[1], tz)}（${Math.round((night[1] - night[0]) * 24 * 10) / 10} 小时）`]);
    else lines.push(['天文夜', { day: '太阳整夜不落（极昼 / 午夜太阳），没有夜', twilight: '太阳虽然落下，但整夜都高于 −18°：没有天文夜（白夜）', 'twilight-polar': '太阳整天在地平线下却高于 −18°：极夜里的暮光季，没有天文夜' }[kind] || (dark ? '这一夜没有真正的天文夜（只有航海暮光以后的暗夜）' : '这一夜太阳始终不够低（高纬度夏季）')]);
    lines.push(['月亮', `月相 ${Math.round(frac * 100)}%，` + (moonUp ? `${moonUp[2] ? '日落时已在天上' : '月出 ' + hhmm(moonUp[0], tz)} · ${moonUp[3] ? '整夜未落' : '月落 ' + hhmm(moonUp[1], tz)}` : '整夜都在地平线下（暗夜）')]);
    lines.push(['银河中心', gcMax > 10 ? `高于 10° 的时段 ${core ? hhmm(core[0], tz) + ' – ' + hhmm(core[1], tz) : '—'}；暗夜里最高 ${Math.round(gcMax)}°（${hhmm(t0 + (gcAt / (N - 1)) * len, tz)}）` : '这一夜在暗夜时段不会升到 10° 以上']);
    this.nightInfo.replaceChildren(...lines.map(([k, v2]) => h('p', {}, h('b', { text: k }), v2)));
    this._tlDirty = true;
  }

  drawTimeline() {
    const n = this.night; if (!n) return;
    const c = this.tl, g = c.getContext('2d'), W = c.width, H = c.height, S = this.app.S, tz = this.ui.tz, d = W / 300;
    const Y = (alt) => 4 * d + (1 - (clamp(alt, -40, 90) + 40) / 130) * (H - 24 * d);
    for (let x = 0; x < W; x++) {
      const f = (x / (W - 1)) * (n.N - 1), i = Math.min(n.N - 2, Math.floor(f)), t = f - i, a = n.sun[i] * (1 - t) + n.sun[i + 1] * t;
      const k = a < -18 ? 0 : a < -12 ? 1 : a < -6 ? 2 : a < 0 ? 3 : 4, col = NIGHT_COL[k];
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; g.fillRect(x, 0, 1, H - 16 * d);
    }
    g.fillStyle = '#05060f'; g.fillRect(0, H - 16 * d, W, 16 * d);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([3 * d, 3 * d]); g.lineWidth = d; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.setLineDash([]);
    const line = (arr, col, w) => {
      g.strokeStyle = col; g.lineWidth = w * d; g.beginPath();
      for (let i = 0; i < n.N; i++) { const x = (i / (n.N - 1)) * W, y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    };
    line(n.moon, 'rgba(226,234,255,.95)', 1.8); line(n.gc, 'rgba(255,155,208,.95)', 1.8);
    // hour ticks
    g.fillStyle = 'rgba(214,220,255,.8)'; g.font = `${10.5 * d}px Bricolage, sans-serif`; g.textAlign = 'center';
    for (let i = 0; i < n.N; i++) {
      const jd = n.t0 + (i / (n.N - 1)) * n.len, z = zoned(Math.round(dateFromJd(jd).getTime() / 60000) * 60000, tz);
      if (z.mi === 0 && z.h % 3 === 0) { const x = (i / (n.N - 1)) * W; g.fillRect(x, H - 16 * d, d, 5 * d); g.fillText(`${pad(z.h)}:00`, clamp(x, 16 * d, W - 16 * d), H - 3 * d); }
    }
    // the preview window and the present
    const x0 = ((S.jd - n.t0) / n.len) * W, x1 = x0 + (this.spanHours() / 24 / n.len) * W;
    if (this.trailMode !== 'none' || this.span) { g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x0, 0, Math.min(x1, W) - x0, H - 16 * d); }
    g.fillStyle = '#fff'; g.fillRect(x0 - d, 0, 2 * d, H - 16 * d);
  }

  // --------------------------------------------------------------------- preview
  preview(record) {
    const app = this.app, S = app.S;
    if (this.run) this.stopPreview(false);
    const hours = this.spanHours(), dur = hours <= 1 ? 8 : hours <= 3 ? 12 : 18;
    this.run = { start: S.jd, span: hours / 24, t0: performance.now(), dur, rec: null, restore: { rate: S.rate } };
    if (this.trailMode === 'ahead') S.trails = -Math.min(170, hours * SIDEREAL);
    S.rate = (hours * 3600) / dur; S.playing = true;
    this.playBtn.replaceChildren(icon('pause'), '停止');
    this.recBtn.disabled = true; this.ui.refreshSpeed();
    if (record) this.#startRecording();
  }
  stopPreview(rewind) {
    const r = this.run; if (!r) return;
    const S = this.app.S;
    this.run = null; S.playing = false; S.rate = 1;
    if (rewind) S.jd = r.start;
    if (this.trailMode === 'grow') S.trails = 0;
    this.#stopRecording(r);
    this.playBtn.replaceChildren(icon('play'), '预演延时'); this.recBtn.disabled = false; this.bar.firstChild.style.width = '0%';
    this.app.emit('state'); this.ui.refreshSpeed(); this.ui.refreshTime(true);
  }

  #startRecording() {
    const r = this.run, app = this.app;
    try {
      const rc = this.rc = document.createElement('canvas'), k = app.canvas.width / innerWidth, R = this.rect;
      const sc = Math.min(1, 1920 / (R.w * k)); rc.width = Math.round(R.w * k * sc); rc.height = Math.round(R.h * k * sc); this.rcs = { k, sc };
      this.rg = rc.getContext('2d');
      const stream = rc.captureStream(30);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('no recorder');
      const chunks = []; const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14e6 });
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' }); if (!blob.size) return;
        const z = zoned(dateFromJd(r.start).getTime(), this.ui.tz), name = `cosmos-timelapse-${z.y}${pad(z.mo)}${pad(z.d)}-${pad(z.h)}${pad(z.mi)}.webm`;
        const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000); this.ui.toast(`已保存 ${name}`);
      };
      mr.start(250); r.rec = mr; this.ui.toast('开始录制');
    } catch (e) { this.rc = null; this.ui.toast('这个浏览器不能录制视频'); }
  }
  #stopRecording(r) { if (r?.rec && r.rec.state !== 'inactive') r.rec.stop(); this.rc = null; }

  // ------------------------------------------------------------------ per frame
  frame() {
    if (!this.active) return;
    const app = this.app, S = app.S, r = this.run;
    // equatorial tracking: hold the same direction among the stars
    if (this.track && this._trackDir) {
      if (app._drag) this.captureTrack();
      else { const d = dirToHoriz(this._trackDir, localFrame(S.lat, lstDeg(S.jd, S.lon), this._fr)); S.az = d.az; S.alt = clamp(d.alt, -89, 89.5); }
    }
    if (r) {
      const p = (S.jd - r.start) / r.span;
      this.bar.firstChild.style.width = clamp(p * 100, 0, 100) + '%';
      if (this.trailMode === 'grow') S.trails = Math.min(170, Math.max(0, S.jd - r.start) * 24 * SIDEREAL);
      if (p >= 1) { this.ui.toast('预演结束'); this.stopPreview(true); }
      if (this.rc && this.rg) {
        const R = this.rect, { k, sc } = this.rcs, g = this.rg, c = this.rc;
        g.drawImage(app.canvas, R.x * k, R.y * k, R.w * k, R.h * k, 0, 0, c.width, c.height);
        const z = zoned(dateFromJd(S.jd).getTime(), this.ui.tz), u = c.height / 700;
        g.font = `600 ${Math.round(18 * u)}px Bricolage, sans-serif`; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.82)';
        g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 6 * u; g.fillText(`${pad(z.h)}:${pad(z.mi)}`, c.width - 18 * u, c.height - 16 * u); g.shadowBlur = 0;
      }
    }
    const t = performance.now();
    if (this._dirty && t - this._sync > 160 && !this._tld) {
      this._dirty = false; this._sync = t;
      if (document.activeElement?.type !== 'range') this.sl.forEach((s) => s.sync());
      this.computeNight(); this._tlDirty = true;
    }
    if (this._tlDirty || r) { this._tlDirty = false; this.drawTimeline(); }
  }
}
