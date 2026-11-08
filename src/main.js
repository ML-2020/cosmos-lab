// Entry point.  Boots the App, the interface, and a small test API for the headless screenshot harness.
//   #clean  -> bare engine (tools/shot.mjs default)     #nohero -> interface without the opening page
import * as THREE from 'three';
import { App } from './app.js';
import * as astro from './astro.js';
import { UI } from './ui/ui.js';

const hash = location.hash.replace('#', '');
const app = new App(document.getElementById('gl'), document.getElementById('labels'), hash === 'clean' ? {} : { model: 'ptolemy' });
let ui = null;
if (hash !== 'clean') {
  ui = new UI(app, document.getElementById('ui'), document.getElementById('labels'), { hero: hash !== 'nohero' });
  if (hash === 'nohero') document.body.classList.add('entered');
}
window.__app = {
  app, astro, ui, THREE,
  set(s) { app.set(s); app.tick(0); },
  async settle(n = 4) { for (let i = 0; i < n; i++) { app.tick(1 / 30); await new Promise((r) => requestAnimationFrame(r)); } },
  info() {
    const S = app.S, c = app.cond;
    return { model: S.model, zoom: +S.zoom.toFixed(3), D: app.ctx?.D, g: app.ctx?.g, sunAlt: +c.sunAlt.toFixed(1), moonAlt: +c.moonAlt.toFixed(1), readout: app.readout() };
  },
};
window.__ready = true;
app.tick(0);
app.run();
