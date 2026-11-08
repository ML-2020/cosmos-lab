// How well do the Ptolemaic circles reproduce the real sky?  node tools/test_ptolemy.mjs [variant json]
import * as THREE from 'three';
import { Ephemeris, jdFromDate, eclToScene } from '../src/astro.js';
import { PtolemaicSystem, sepDeg } from '../src/models/ptolemy_mech.js';

const opts = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const sys = new PtolemaicSystem(opts);
const eph = new Ephemeris();
const j0 = jdFromDate(new Date('2000-01-01')), j1 = jdFromDate(new Date('2060-01-01'));
const stats = {};
const add = (k, e) => { const s = (stats[k] ??= { n: 0, sum2: 0, max: 0 }); s.n++; s.sum2 += e * e; s.max = Math.max(s.max, e); };
const toDate = (v) => eclToScene(v.x, v.y, v.z, new THREE.Vector3()).applyMatrix4(eph.P);
for (let jd = j0; jd < j1; jd += 5.37) {
  eph.update(jd);
  add('sun', sepDeg(toDate(sys.sun(jd).S), eph.sun));
  add('moon', sepDeg(toDate(sys.moon(jd).moon), eph.moon));
  for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn']) add(id, sepDeg(toDate(sys.planet(id, jd).planet), eph.planets[id].geo));
}
for (const [k, s] of Object.entries(stats)) console.log(k.padEnd(8), 'rms', Math.sqrt(s.sum2 / s.n).toFixed(3).padStart(6), '  max', s.max.toFixed(3).padStart(6), 'deg');
