// Debug harness: node tools/dbg.mjs out.png '{state}' 'js to eval before the shot (has app, m)' [w h]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const [, , out, stateJson = '{}', code = '', w = '1280', h = '800'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 200)); }); page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e.stack || e.message).slice(0, 600)));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + (process.env.UI === 'hero' ? '' : process.env.UI ? '#nohero' : '#clean'));
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const r = await page.evaluate(async ([s, c]) => { const { app } = window.__app; app.set(s); await window.__app.settle(3); const m = app.model; const v = c ? eval(c) : null; await window.__app.settle(3); return v === undefined ? null : v; }, [JSON.parse(stateJson), code]);
if (r !== null) console.log(JSON.stringify(r));
await page.screenshot({ path: out });
console.log(logs.length ? logs.join('\n') : 'console: clean');
await browser.close();
