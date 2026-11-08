// UI smoke test: every model x zoom, the comparison ledger, photographer mode, preview + recording.  Prints page errors.
//   node tools/test_ui.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 520, height: 340 }, deviceScaleFactor: 1, acceptDownloads: true });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 240)); }); page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e.stack || e.message).slice(0, 700)));
let downloads = 0; page.on('download', (d) => { downloads++; logs.push('[download] ' + d.suggestedFilename()); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#nohero');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const { app, ui } = window.__app, out = {};
  const nap = () => new Promise((r) => requestAnimationFrame(r));
  for (const id of ['flat', 'globe', 'ptolemy', 'helio']) {
    ui.setModel(id); app.set({ zoomTarget: 1, zoom: 1, lat: -33.87, lon: 151.21 }); app.S.zoom = 1; app.tick(1 / 30); await nap();
    ui.updateLedger();
    const rows = app.compare().map((r) => `${r.key}:${r.model ? r.err.toFixed(1) : '-'}`);
    out[id] = rows.join(' ');
    app.S.zoom = app.S.zoomTarget = 0.3; app.tick(1 / 30); await nap();
  }
  // the time bar must not change size while time races (the old clock label made the right side shake)
  ui.setModel('globe'); app.S.zoom = app.S.zoomTarget = 1; ui.setRate(86400 * 365); const ws = new Set(), xs = new Set();
  for (let i = 0; i < 14; i++) { app.tick(0.1); await nap(); ws.add(Math.round(ui.dock.querySelector('.timebar').getBoundingClientRect().width)); xs.add(Math.round(ui.nowBtn.getBoundingClientRect().left)); }
  out.timebarWidths = [...ws]; out.nowBtnLeft = [...xs]; ui.setRate(1);
  out.bestTime = ui.clockB.textContent; out.guideLabels = ui.labels.cand.filter((c) => c.kind === 'guide' || c.kind === 'gstar').map((c) => c.text).join(',');
  ui.setModel('ptolemy'); app.S.zoom = app.S.zoomTarget = 0; app.tick(1 / 30);
  const ph = ui.photo; ph.enter(); app.S.zoom = app.S.zoomTarget = 1; app._journey = null; app.tick(1 / 30); await nap();
  out.photoModel = app.S.model; out.fov = +app.S.fov.toFixed(2); ph.pointAt('galcentre'); ph.setFocal(85); out.fov85 = +app.S.fov.toFixed(2);
  ph.computeNight(); out.night = ph.nightInfo.textContent;
  ph.trailMode = 'grow'; ph.refreshTrails(); ph.preview(true);
  const jd0 = app.S.jd; for (let i = 0; i < 10; i++) { app.tick(0.1); await nap(); await new Promise((r) => setTimeout(r, 120)); }
  out.advanced = +((app.S.jd - jd0) * 24).toFixed(3); out.rec = ph.run?.rec?.state; out.trails = +app.S.trails.toFixed(2);
  ph.stopPreview(true); await new Promise((r) => setTimeout(r, 2500));
  ph.exit(); out.afterExit = app.S.model + ' fov' + app.S.fov;
  return out;
});
await page.close();
// opening page: pick a model, start the descent, interrupt it, open the pop-overs
const p2 = await browser.newPage({ viewport: { width: 520, height: 340 }, deviceScaleFactor: 1 });
p2.on('pageerror', (e) => logs.push('[pageerror:hero] ' + String(e.stack || e.message).slice(0, 700)));
p2.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push('[hero] ' + m.text().slice(0, 240)); });
await p2.goto(pathToFileURL(resolve('dist/index.html')).href, { timeout: 90000 });
await p2.waitForFunction('window.__ready === true', null, { timeout: 90000 });
res.hero = await p2.evaluate(async () => {
  const { app, ui } = window.__app, out = {}, nap = () => new Promise((r) => requestAnimationFrame(r));
  out.heroVisible = !ui.hero.classList.contains('gone');
  ui.hero.querySelector('.pick button').click();                      // first chip = 地平说
  out.afterPick = app.S.model;
  ui.hero.querySelector('.btn.solid').click();                        // 从掌心开始
  out.entered = document.body.classList.contains('entered') && ui.hero.classList.contains('gone');
  for (let i = 0; i < 4; i++) { app.tick(0.5); await nap(); }
  out.zoomDuring = +app.S.zoom.toFixed(3); out.journey = !!app._journey;
  ui.ruler.root.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }));
  out.interrupted = !app._journey;
  ui.togglePop('layers', ui.btnLayers); out.layersPop = !!ui.pop; ui.closePop();
  ui.togglePop('place', ui.placeBtn); out.placePop = !!ui.pop; ui.closePop();
  dispatchEvent(new KeyboardEvent('keydown', { key: '3' })); out.keyModel = app.S.model;
  dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })); out.clean = document.body.classList.contains('clean'); dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
  ui.setPlace({ name: '悉尼', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney', elev: 58 }); out.clock = ui.clockS.textContent;
  // new in round 7: the North Pole, polar night handling, observer height, the magnetic layer, aurora/meteors/satellites
  ui.setPlace({ name: '北极点', lat: 89.9, lon: 0, tz: 'UTC', elev: 0 }); ui.goBest('button');
  out.poleKind = ui.nightKind; out.poleSunAlt = +app.cond.sunAlt.toFixed(1); out.poleToast = document.querySelector('.toast')?.textContent;
  ui.setPlace({ name: '特罗姆瑟', lat: 69.6492, lon: 18.9553, tz: 'Europe/Oslo', elev: 10 });
  for (const id of ['flat', 'globe', 'ptolemy', 'helio']) {
    ui.setModel(id); app.set({ zoomTarget: 1, zoom: 1, kp: 6, height: 3000, snap: true }); app.S.zoom = 1; app.tick(0.2); await nap(); app.tick(0.2); await nap();
    const cp = app.model.fx.compass; ui.updateMag();
    out['mag_' + id] = `decl ${cp.decl.toFixed(1)} model-az ${cp.modelAz.toFixed(1)} | ${ui.mgText.textContent.slice(0, 22)} | horizon row ${app.compare().some((r) => r.key === 'horizon')} | eye ${Math.round(app.eyeM)}`;
    app.set({ height: 0, snap: true });
  }
  out.fx = { aurora: app.model.fx.aurora.mesh.visible, meteors: app.model.fx.meteors.mesh.visible, sats: app.model.fx.sats.points.visible, nSats: app.model.fx.sats.mag.length };
  ui.togglePop('place', ui.placeBtn); out.placePopHeights = ui.pop.el.querySelectorAll('.chip').length; ui.closePop();
  ui.togglePop('layers', ui.btnLayers); out.layersSky = ui.pop.el.textContent.includes('极光活动'); ui.closePop();
  // round 9: the 日月对照 block (charts, table, per-model text), the path/trail chips and the path overlay canvas
  ui.setPlace({ name: '上海', lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai', elev: 4 }); app.set({ rate: 0, playing: false });
  ui.opts.sheet = true; ui.sheet.classList.remove('closed');
  const lumTexts = {};
  for (const id of ['flat', 'globe', 'ptolemy', 'helio']) {
    ui.setModel(id); for (let i = 0; i < 80 && !(ui.lum.data && ui.lum.key); i++) await new Promise((r) => setTimeout(r, 100));
    ui.lum.update(); lumTexts[id] = ui.lum.text.textContent.slice(0, 14);
  }
  const lb = ui.sheet.querySelector('.lumblock'), nPaths = () => lb.querySelectorAll('.lumsvg .lp').length;
  const n1 = nPaths(); ui.lum.legend.querySelector('button[data-id=flat]').click(); const n2 = nPaths(); ui.lum.legend.querySelector('button[data-id=flat]').click();
  const svg = lb.querySelectorAll('.lumsvg')[0], rc = svg.getBoundingClientRect(); svg.dispatchEvent(new PointerEvent('pointermove', { clientX: rc.left + rc.width / 2, clientY: rc.top + 20, bubbles: true }));
  out.lum = { rows: lb.querySelectorAll('.lumtab tbody tr').length, figs: lb.querySelectorAll('.lumfig').length, lines: n1, linesWithoutFlat: n2, tooltip: !lb.querySelector('.lumtip').hidden, texts: lumTexts, distinctTexts: new Set(Object.values(lumTexts)).size,
    flatSepBig: ui.lum.data.sepS.flat > 10, globeSep0: ui.lum.data.sepS.globe < 0.05 && ui.lum.data.sepM.helio < 0.05, ptolemyMoonSwing: ui.lum.data.moon.ptolemy.some((v) => v > 38) };
  ui.togglePop('layers', ui.btnLayers); out.lumChips = ['日月轨迹', '四季日轨', '日月拖尾'].every((t) => ui.pop.el.textContent.includes(t)); ui.closePop();
  out.pathCanvas = !!document.querySelector('#labels canvas.pathcv');
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log('downloads:', downloads);
console.log(logs.length ? logs.join('\n') : 'console: clean');
await browser.close();
