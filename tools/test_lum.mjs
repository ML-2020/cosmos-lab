// Sun / Moon predictions at arbitrary times (app.lumAt) must agree with what the live model shows (app.compare), in all four cosmologies.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 480, height: 300 }, deviceScaleFactor: 1 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#clean');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const res = await page.evaluate(async () => {
  const { app } = window.__app, out = [];
  const sep = (a, b) => { const r = Math.PI / 180, A = a.alt * r, B = b.alt * r, d = (a.az - b.az) * r; return Math.acos(Math.min(1, Math.max(-1, Math.sin(A) * Math.sin(B) + Math.cos(A) * Math.cos(B) * Math.cos(d)))) / r; };
  const cases = [
    { lat: 31.23, lon: 121.47, jd: 2461350.08 }, { lat: 31.23, lon: 121.47, jd: 2461350.58 },
    { lat: -33.87, lon: 151.21, jd: 2461400.3 }, { lat: 69.65, lon: 18.96, jd: 2461000.1 },
  ];
  for (const m of ['flat', 'globe', 'ptolemy', 'helio']) for (const c of cases) {
    app.set({ model: m, zoom: 1, zoomTarget: 1, playing: false, lat: c.lat, lon: c.lon, jd: c.jd, alt: 30, az: 180 });
    await window.__app.settle(3);
    const rows = Object.fromEntries(app.compare().map((r) => [r.key, r]));
    const L = app.lumAt(c.jd);
    for (const k of ['sun', 'moon']) {
      const r = rows[k], mine = L.mine[k], real = L.real[k];
      out.push({ m, lat: c.lat, k, dModel: r.model ? +sep(r.model, mine).toFixed(3) : null, dReal: +sep(r.real, real).toFixed(3), dist: +mine.dist.toFixed(2), realDist: +real.dist.toFixed(2) });
    }
  }
  return out;
});
let bad = 0;
for (const r of res) { const ok = (r.dModel == null || r.dModel < 0.05) && r.dReal < 0.05; if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(r)); }
console.log(logs.length ? logs.join('\n') : 'console: clean'); console.log(bad ? `${bad} FAILED` : 'all passed');
await browser.close(); process.exit(bad ? 1 : 0);
