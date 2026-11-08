// Plays time with the full interface and saves a screenshot every `gap` ms.
//   node tools/play.mjs outPrefix '{state}' count [w h] [gapMs]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const [, , prefix = '/tmp/play', stateJson = '{}', count = '6', w = '1100', h = '700', gap = '1500'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 300)); }); page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e.stack || e.message).slice(0, 600)));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#nohero');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
await page.evaluate(async (s) => { window.__app.set(s); await window.__app.settle(3); }, JSON.parse(stateJson));
for (let i = 0; i < +count; i++) {
  await page.waitForTimeout(+gap);
  await page.screenshot({ path: `${prefix}_${i}.png` });
  const jd = await page.evaluate(() => window.__app.app.S.jd);
  console.log(i, jd.toFixed(4));
}
console.log(logs.length ? logs.join('\n') : 'console: clean');
await browser.close();
