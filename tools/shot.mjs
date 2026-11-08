// Headless screenshot harness.
//   node tools/shot.mjs out.png '{"model":"globe","zoom":1}' [width height] [settleFrames]
// Loads dist/index.html, calls window.__app.set(state), renders frames, saves a PNG and
// prints any console errors so failures are never silent.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');

const [, , outPath = '/tmp/shot.png', stateJson = '{}', w = '1440', h = '900', frames = '6'] = process.argv;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = pathToFileURL(resolve('dist/index.html')).href + (process.env.UI === 'hero' ? '' : process.env.UI ? '#nohero' : '#clean');   // UI=1 keeps the interface, default = bare engine
await page.goto(url);
try {
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
} catch (e) { logs.push('[timeout] window.__ready never became true'); }
const state = JSON.parse(stateJson);
if (Object.keys(state).length || true) {
  const r = await page.evaluate(async ([s, n]) => { if (!window.__app) return 'no __app'; window.__app.set(s); await window.__app.settle(n); return window.__app.info ? window.__app.info() : 'ok'; }, [state, +frames]);
  if (r && r !== 'ok') console.log('info:', typeof r === 'string' ? r : JSON.stringify(r));
}
await page.screenshot({ path: outPath });
console.log('saved', outPath);
if (logs.length) console.log(logs.slice(0, 25).join('\n')); else console.log('console: clean');
await browser.close();
