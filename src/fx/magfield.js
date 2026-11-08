// The magnetic layer: where each cosmology has to put the two magnetic poles, the geomagnetic equator and the field lines.
// Real: pole positions (WMM2025 dip poles = where a compass needle stands on end; geomagnetic poles = ends of the best-fit
// bar magnet), the tilted-dipole field-line shape.  Each cosmology draws them with its own geometry: a sphere carries the
// dipole through the Earth; on the flat disc the same places are just points, and the field lines must arc over the disc
// from the centre to the rim.
import * as THREE from 'three';
import { logDepth, glowTexture, clamp } from '../util.js';
import { ll2v, dipoleLine } from '../magnetic.js';

const R_KM = 6371;
const LS = [1.5, 2.2, 3.4, 5.5], MLONS = 6, NP = 36;
const std2scene = (p, out) => out.set(p[0], p[2], -p[1]);

const LINE_VERT = /* glsl */ `
attribute float aS; attribute float aSeed;
varying float vS, vSeed;
void main(){ vS = aS; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LINE_FRAG = /* glsl */ `
uniform float uTime, uAlpha;
varying float vS, vSeed;
void main(){
  float flow = smoothstep(0.55, 1.0, fract(vS * 2.0 - uTime * 0.10 + vSeed));
  float ends = smoothstep(0.0, 0.12, vS) * smoothstep(1.0, 0.88, vS);
  vec3 south = vec3(0.35, 0.65, 1.0), north = vec3(1.0, 0.45, 0.30);
  vec3 c = mix(south, north, vS);
  gl_FragColor = vec4(c * (0.10 + 0.85 * flow) * (0.35 + 0.65 * ends), 1.0) * uAlpha;
}`;

export class MagLayer {
  constructor(model) {
    this.m = model; this._key = ''; this.group = new THREE.Group(); this.group.name = 'magnetism';
    this.u = { uTime: { value: 0 }, uAlpha: { value: 1 } };
    this.lineMat = new THREE.ShaderMaterial({ uniforms: this.u, ...logDepth(LINE_VERT, LINE_FRAG), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMat); this.lines.frustumCulled = false; this.lines.renderOrder = 5;
    // markers
    const gl = glowTexture(128), mk = (color, size) => new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: gl, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mkN = mk(0xff5a3c, 34); this.mkS = mk(0x4aa8ff, 34); this.mkGN = mk(0xffd9a0, 18); this.mkGS = mk(0xa8d4ff, 18); this.mkR = mk(0xffffff, 14);
    for (const p of [this.mkN, this.mkS, this.mkGN, this.mkGS, this.mkR]) { p.renderOrder = 30; p.frustumCulled = false; }
    const lm = (c, o) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    this.pinN = new THREE.Line(new THREE.BufferGeometry(), lm(0xff7a5a, 0.9)); this.pinS = new THREE.Line(new THREE.BufferGeometry(), lm(0x6ab8ff, 0.9));
    this.axis = new THREE.Line(new THREE.BufferGeometry(), lm(0xffe2b0, 0.5));
    this.equator = new THREE.LineLoop(new THREE.BufferGeometry(), lm(0xffe2b0, 0.55));
    this.compass = new THREE.Line(new THREE.BufferGeometry(), lm(0xffd24a, 0.9));
    this.group.add(this.lines, this.mkN, this.mkS, this.mkGN, this.mkGS, this.mkR, this.pinN, this.pinS, this.axis, this.equator, this.compass);
    this.pts = {};          // Earth-frame positions of the markers (for labels)
  }

  _set(obj, arr) { obj.geometry.setFromPoints(arr); }

  // rebuild when the poles have moved or the place changed
  update(ctx, S, st, near = 1) {
    const flat = this.m.id === 'flat';
    const key = `${st.dipN.lat.toFixed(2)},${st.dipN.lon.toFixed(1)},${st.geoN.lat.toFixed(2)},${S.lat.toFixed(2)},${S.lon.toFixed(2)}`;
    if (key !== this._key) { this._key = key; this.#rebuild(st, S, flat); }
    this.u.uTime.value = ctx.time;
    const k = (1 - clamp((ctx.zoom - 0.40) / 0.22, 0, 1)) * near;      // the picture belongs to the palm view
    this.u.uAlpha.value = k;
    for (const o of [this.lines, this.axis, this.equator, this.compass, this.pinN, this.pinS]) { o.visible = S.mag && k > 0.01; }
    this.axis.visible = this.axis.visible && !flat;
    for (const o of [this.lines]) o.visible = S.mag && k > 0.01;
    for (const o of [this.mkN, this.mkS, this.mkGN, this.mkGS, this.mkR]) { o.visible = S.mag && k > 0.01; o.material.opacity = k; }
    for (const o of [this.axis, this.equator, this.compass, this.pinN, this.pinS]) o.material.opacity = (o.userData.o ??= o.material.opacity) * (k > 0.01 ? k : 0);
  }

  #rebuild(st, S, flat) {
    const m = this.m, V = () => new THREE.Vector3();
    const uOf = (lat, lon) => std2scene(ll2v(lat, lon), V());
    // field lines (tilted dipole)
    const seg = [], sArr = [], seed = [];
    const hCap = (flat ? 0.9 * (m.params?.domeH ?? 1) : 4) * R_KM;
    for (const L of LS) for (let a = 0; a < MLONS; a++) {
      const pts = dipoleLine(L, (a / MLONS) * 360 + (L * 17) % 45, st.geoN, NP), P = [];
      pts.forEach((p) => { const r = Math.hypot(...p), u = std2scene([p[0] / r, p[1] / r, p[2] / r], V()); P.push(m.earthPoint(u, Math.min((r - 1) * R_KM, hCap), V())); });
      const sd = ((a * 0.37 + L * 0.21) % 1);
      for (let i = 0; i < P.length - 1; i++) { seg.push(P[i], P[i + 1]); sArr.push(i / (P.length - 1), (i + 1) / (P.length - 1)); seed.push(sd, sd); }
    }
    const g = new THREE.BufferGeometry().setFromPoints(seg);
    g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(sArr), 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seed), 1));
    this.lines.geometry.dispose(); this.lines.geometry = g;
    // poles
    const uN = uOf(st.dipN.lat, st.dipN.lon), uS = uOf(st.dipS.lat, st.dipS.lon), gN = uOf(st.geoN.lat, st.geoN.lon), gS = uOf(st.geoS.lat, st.geoS.lon);
    const at = (u, h) => m.earthPoint(u, h, V());
    const place = (pt, p) => { pt.geometry.attributes.position.setXYZ(0, p.x, p.y, p.z); pt.geometry.attributes.position.needsUpdate = true; };
    const pN = at(uN, 60), pS = at(uS, 60);
    place(this.mkN, pN); place(this.mkS, pS); place(this.mkGN, at(gN, 40)); place(this.mkGS, at(gS, 40));
    place(this.mkR, at(new THREE.Vector3(0, 1, 0), 40));
    this._set(this.pinN, [at(uN, 0), at(uN, 2600)]); this._set(this.pinS, [at(uS, 0), at(uS, 2600)]);
    this.pts = { dipN: pN, dipS: pS, geoN: at(gN, 40), geoS: at(gS, 40), rot: at(new THREE.Vector3(0, 1, 0), 40) };
    // tilted-dipole axis through the Earth (sphere models only)
    if (!flat) this._set(this.axis, [gS.clone().multiplyScalar(2.2), gN.clone().multiplyScalar(2.2)]);
    // geomagnetic equator
    const eq = [], z = ll2v(st.geoN.lat, st.geoN.lon); let x0 = [-z[1], z[0], 0]; const l0 = Math.hypot(x0[0], x0[1]) || 1; x0 = [x0[0] / l0, x0[1] / l0, 0];
    const y0 = [z[1] * x0[2] - z[2] * x0[1], z[2] * x0[0] - z[0] * x0[2], z[0] * x0[1] - z[1] * x0[0]];
    for (let i = 0; i < 180; i++) { const a = (i / 180) * Math.PI * 2; eq.push(at(std2scene([Math.cos(a) * x0[0] + Math.sin(a) * y0[0], Math.cos(a) * x0[1] + Math.sin(a) * y0[1], Math.cos(a) * x0[2] + Math.sin(a) * y0[2]], V()), 20)); }
    this._set(this.equator, eq);
    // the compass course: from the observer to the north dip pole, as this cosmology draws a straight course
    this._set(this.compass, m.earthPath(uOf(S.lat, S.lon), uN, 64, 25, []));
    this.compass.computeLineDistances?.();
  }
}
