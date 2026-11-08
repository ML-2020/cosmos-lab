// Proof test for the post pipeline: put a few pixels that evaluate to NaN into the scene and count the pure-black tiles in the result.
//   node tools/nan_inject.mjs   -> prints { tilesWithNaN, tilesWithout }  (the fixed build must report 0 for both)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 300)); }); page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(pathToFileURL(resolve('dist/index.html')).href + '#clean');
await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const r = await page.evaluate(async () => {
  const { app } = window.__app; app.set({ model: 'globe', zoom: 1, zoomTarget: 1, lat: 31.23, lon: 121.47, jd: 2461350.08, playing: false, alt: 40, az: 180 });
  const tiles = () => {
    const gl = app.renderer.getContext(), cw = app.renderer.domElement.width, ch = app.renderer.domElement.height, px = new Uint8Array(cw * ch * 4);
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; const T = 6;
    for (let ty = 0; ty + T <= ch; ty += T) for (let tx = 0; tx + T <= cw; tx += T) { let z = true; for (let y = 0; y < T && z; y++) for (let x = 0; x < T; x++) { const o = ((ty + y) * cw + tx + x) * 4; if (px[o] + px[o + 1] + px[o + 2] > 0) { z = false; break; } } if (z) n++; }
    return n;
  };
  for (let i = 0; i < 3; i++) app.tick(1 / 30);
  const without = tiles();
  // a handful of points whose colour is NaN at run time (sqrt of a negative uniform value)
  const { THREE } = window.__app;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uNeg: { value: -1 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); gl_PointSize = 3.0; }',
    fragmentShader: 'uniform float uNeg; void main(){ float n = sqrt(uNeg); gl_FragColor = vec4(n, n, n, 1.0); }',
    depthTest: false, depthWrite: false, transparent: false,
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.4, 0.2, 0, 0.3, -0.3, 0, 0.1, 0.5, 0]), 3));
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 99; app.scene.add(pts);
  for (let i = 0; i < 3; i++) app.tick(1 / 30);
  const withNaN = tiles();
  // mean brightness (0-255) of a 64x64 window around each injected point, before and after
  const win = (cx, cy) => { const gl = app.renderer.getContext(), cw = app.renderer.domElement.width, ch = app.renderer.domElement.height, px = new Uint8Array(64 * 64 * 4); gl.readPixels(Math.round((cx * 0.5 + 0.5) * cw) - 32, Math.round((cy * 0.5 + 0.5) * ch) - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px); let t = 0; for (let i = 0; i < px.length; i += 4) t += px[i] + px[i + 1] + px[i + 2]; return +(t / (64 * 64 * 3)).toFixed(2); };
  const P = [[-0.4, 0.2], [0.3, -0.3], [0.1, 0.5]];
  const after = P.map(([x, y]) => win(x, y));
  pts.visible = false; for (let i = 0; i < 3; i++) app.tick(1 / 30);
  const before = P.map(([x, y]) => win(x, y));
  return { tilesWithout: without, tilesWithNaN: withNaN, windowMeanBefore: before, windowMeanWithNaN: after };
});
console.log(JSON.stringify(r)); console.log(logs.length ? logs.join('\n') : 'console: clean');
await browser.close();
