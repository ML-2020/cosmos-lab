// Numerical check of the first-person camera: where do known directions land on screen?
//   node tools/check_view.mjs '{"model":"globe","zoom":1,"az":195,"alt":22,"fov":95}'
// Prints, for the view centre, the horizon, and a few named stars: real alt/az, model alt/az, and pixel.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');

const [, , stateJson = '{}', w = '1440', h = '900'] = process.argv;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#clean');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const out = await page.evaluate(async ([s, W, H]) => {
  const { app, astro } = window.__app;
  app.set(s); await window.__app.settle(4);
  const m = app.model, S = app.S, cam = app.camera;
  const V = (x, y, z) => new cam.position.constructor(x, y, z);
  const toPx = (p) => { const q = p.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); return { x: +((q.x * 0.5 + 0.5) * W).toFixed(1), y: +((0.5 - q.y * 0.5) * H).toFixed(1), z: +q.z.toFixed(3) }; };
  const res = { view: { az: S.az, alt: S.alt, fov: S.fov, lat: S.lat, lst: astro.lstDeg(S.jd, S.lon) } };
  const dirPx = (az, alt) => { const d = m.lookDir(az, alt, V(0, 0, 0)); return toPx(d.multiplyScalar(1000)); };
  res.centre = dirPx(S.az, S.alt);
  res.horizonAtView = dirPx(S.az, 0);
  res.horizonLeft10 = dirPx(S.az - 30, 0);
  res.horizonRight10 = dirPx(S.az + 30, 0);
  res.zenith = dirPx(0, 89.9);
  const frame = astro.localFrame(S.lat, astro.lstDeg(S.jd, S.lon));
  const eph = app.eph;
  const stars = {};
  for (const a of m.sky.labelAnchors()) if (a.kind === 'star' && ['Polaris', 'Antares', 'Vega', 'Arcturus', 'Sirius', 'Altair', 'Deneb'].includes(a.sub || a.text)) {
    const local = a.pos.clone().applyMatrix4(m.sky.j2000.matrixWorld);               // render space
    const world = local.clone().add(app.shift);                                       // model coords
    const real = astro.dirToHoriz(a.pos.clone().normalize().applyMatrix4(eph.P), frame);
    const mod = m.horizontal(world);
    stars[a.sub || a.text] = { real: [+real.az.toFixed(2), +real.alt.toFixed(2)], model: [+mod.az.toFixed(2), +mod.alt.toFixed(2)], px: toPx(local) };
  }
  res.stars = stars;
  const gc = astro.eqToVec(266.405, -28.936, 1).applyMatrix4(eph.P);
  const gr = astro.dirToHoriz(gc, frame);
  res.galacticCentre = { az: +gr.az.toFixed(2), alt: +gr.alt.toFixed(2), px: dirPx(gr.az, gr.alt) };
  return res;
}, [JSON.parse(stateJson), +w, +h]);
console.log(JSON.stringify(out, null, 1));
await browser.close();
