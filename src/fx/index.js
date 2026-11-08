// The sky phenomena and the magnetic layer, attached to a cosmology.  Earth-fixed things (aurora, poles, field lines) are children
// of the Earth's own group so every cosmology draws them with its own geometry; things in the observer's local sky (meteors,
// satellites) live in a group pinned to the observer.
import * as THREE from 'three';
import { Aurora } from './aurora.js';
import { MagLayer } from './magfield.js';
import { Meteors } from './meteors.js';
import { Satellites } from './satellites.js';
import { LumPaths, LumTrail } from './lumpaths.js';
import { magneticState, yearOfJd, field, bearingTo } from '../magnetic.js';
import { gmstDeg, D2R, localFrame, lstDeg } from '../astro.js';

const Y = new THREE.Vector3(0, 1, 0);

export class Phenomena {
  constructor(app, model) {
    this.app = app; this.m = model;
    this.aurora = new Aurora(model); this.mag = new MagLayer(model);
    this.meteors = new Meteors(app, model); this.sats = new Satellites(model);
    this.local = new THREE.Group(); this.local.name = 'observer-local';
    this.paths = new LumPaths(app, model); this.trail = new LumTrail(app, model);
    this.local.add(this.meteors.mesh, this.sats.points);
    model.earth.group.add(this.aurora.group, this.mag.group);
    model.group.add(this.local, this.trail.group);
    this._sun = new THREE.Vector3(); this._y = -1; this.state = null; this.compass = null; this._ck = '';
  }

  update(ctx, dtReal) {
    const app = this.app, S = app.S, m = this.m, A = m.anchor, year = yearOfJd(ctx.jd);
    if (!this.state || Math.abs(year - this._y) > 0.02) { this.state = magneticState(year); this._y = year; this._ck = ''; this.drift = null; }
    const st = this.state;
    this._sun.copy(ctx.eph.sun).normalize().applyAxisAngle(Y, -gmstDeg(ctx.jd) * D2R);
    this.aurora.update(ctx, S, st.geoN, this._sun);
    this.near = 1 - Math.min(1, Math.max(0, (ctx.D - 8) / 10));          // the poles and field lines only matter once the Earth is big on screen
    this.mag.update(ctx, S, st, this.near);
    this.local.position.copy(A.pos);
    this.meteors.update(ctx, S, dtReal, A);
    this.sats.update(ctx, S, A);
    this.paths.update(ctx, S, A);
    this.trail.update(ctx, S);
    // what a compass says here, and where each cosmology's own geometry says the pole is
    const ck = `${S.lat.toFixed(3)},${S.lon.toFixed(3)},${S.site},${(year).toFixed(2)}`;
    if (ck !== this._ck) {
      this._ck = ck; const f = field(S.lat, S.lon, S.site / 1000, year);
      const toN = bearingTo(S.lat, S.lon, st.dipN.lat, st.dipN.lon), toS = bearingTo(S.lat, S.lon, st.dipS.lat, st.dipS.lon);
      let modelAz = toN.az;
      if (m.id === 'flat') {                                  // on the disc the straight course to the pole is a straight line on the map
        const P = m.earthPoint(new THREE.Vector3(Math.cos(st.dipN.lat * D2R) * Math.cos(st.dipN.lon * D2R), Math.sin(st.dipN.lat * D2R), -Math.cos(st.dipN.lat * D2R) * Math.sin(st.dipN.lon * D2R)), 0, new THREE.Vector3()).sub(A.pos);
        modelAz = (Math.atan2(P.dot(A.east), P.dot(A.north)) / D2R + 360) % 360;
      }
      this.compass = { ...f, toN, toS, modelAz };
    }
  }

  // how fast the north dip pole is wandering (km per year), from the model five years apart
  poleDrift() {
    if (this.drift) return this.drift;
    const a = magneticState(this._y - 2.5).dipN, b = magneticState(this._y + 2.5).dipN, r = D2R;
    const c = Math.acos(Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r));
    return (this.drift = c * 6371 / 5);
  }

  // after the camera is placed: view-space 'up' of the observer, for horizon dimming
  prepare(cam) { this.aurora.u.uUpV.value.copy(this.m.anchor.up).transformDirection(cam.matrixWorldInverse); }

  // labels for the palm view (model coordinates of the markers)
  labelItems() {
    const M = this.mag; if (!this.app.S.mag || !M.pts.dipN || this.near < 0.3) return [];
    const mat = this.m.earth.group.matrix, flat = this.m.id === 'flat', c = this.m.earth.group.position, cam = this.app.shift;
    const p = (v) => v.clone().applyMatrix4(mat);
    const side = (q) => flat || q.clone().sub(c).dot(cam.clone().sub(q)) > 0;          // a pole on the far side of the sphere is hidden behind it
    const items = [
      { kind: 'mag n', text: '磁北极', pos: p(M.pts.dipN) },
      { kind: 'mag s', text: '磁南极', pos: p(M.pts.dipS) },
      { kind: 'mag sub', text: '偶极轴北端', pos: p(M.pts.geoN) },
      { kind: 'mag sub', text: '偶极轴南端', pos: p(M.pts.geoS) },
      { kind: 'mag sub', text: '自转北极', pos: p(M.pts.rot) },
    ];
    return items.filter((it) => side(it.pos));
  }

  // labels in the first-person sky (positions in model coordinates)
  skyLabels() {
    const out = [], A = this.m.anchor, S = this.app.S;
    for (const it of this.paths.labels) out.push(it);
    if (S.sats) for (const v of this.sats.visible) out.push({ pos: this.sats.labelPos(v.i, new THREE.Vector3()).add(A.pos), text: `${v.zh}（示意）`, c: '#cfe6ff' });
    return out;
  }
}
