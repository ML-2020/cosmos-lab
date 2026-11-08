// Playback NaN/Inf hunter: runs the page with time playing and reports, per frame, how many HDR pixels are
// non-finite or absurdly bright (those become black squares after the bloom pyramid).
//   node tools/nan.mjs '{state}' frames [w h] [stepFrames]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const [, , stateJson = '{}', frames = '40', w = '640', h = '400', every = '1'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 300)); }); page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e.stack || e.message).slice(0, 600)));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#nohero');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const out = await page.evaluate(async ([s, n, every]) => {
  const { app } = window.__app; app.set(s);
  const rt = app.post.rtScene, W = rt.width, H = rt.height, res = [];
  for (let f = 0; f < n; f++) {
    app.tick(1 / 30);
    if (f % every === 0) {
      let bad = 0, big = 0, mx = 0, first = null;
      try {
        const buf = new Uint16Array(W * H * 4);
        app.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        const dec = (h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; if (e === 31) return m ? NaN : sg * Infinity; return e === 0 ? sg * m * 5.960464477539063e-8 : sg * (1 + m / 1024) * 2 ** (e - 15); };
        for (let i = 0; i < buf.length; i += 4) {
          const r = dec(buf[i]), g = dec(buf[i + 1]), b = dec(buf[i + 2]);
          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { bad++; if (!first) first = [(i / 4) % W, Math.floor(i / 4 / W)]; }
          else { const m = Math.max(r, g, b); if (m > 200) big++; if (m > mx) mx = m; }
        }
      } catch (e) { return { err: String(e) }; }
      // final picture: tiles of 6x6 pixels that are pure black (a NaN that went through bloom ends up exactly like this)
      const gl = app.renderer.getContext(), cw = app.renderer.domElement.width, ch = app.renderer.domElement.height, px = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let tiles = 0, tileAt = null; const T = 6;
      for (let ty = 0; ty + T <= ch; ty += T) for (let tx = 0; tx + T <= cw; tx += T) {
        let z = true;
        for (let y = 0; y < T && z; y++) for (let x = 0; x < T; x++) { const o = ((ty + y) * cw + tx + x) * 4; if (px[o] + px[o + 1] + px[o + 2] > 0) { z = false; break; } }
        if (z) { tiles++; if (!tileAt) tileAt = [tx, ch - ty]; }
      }
      const mt = app.model.fx?.meteors, nm = mt ? mt.slots.filter((q) => q.on).length : -1;
      res.push({ f, jd: +app.S.jd.toFixed(4), bad, big, mx: +mx.toFixed(1), first, tiles, tileAt, nm });
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return res;
}, [JSON.parse(stateJson), +frames, +every]);
console.log(JSON.stringify(out));
console.log(logs.length ? logs.join('\n') : 'console: clean');
await browser.close();
