// Aurora: curtains of light 90-340 km up along the auroral ovals around the two geomagnetic poles.
// Real: where the ovals are centred (the geomagnetic poles from WMM2025), how they grow equatorward with geomagnetic
// activity (Kp), that they are brightest near magnetic midnight and invisible by day, and the colours by height
// (green 557.7 nm near 110 km, red 630 nm above ~200 km, pink N2 fringe below).  Illustrative: the exact shape, rays and
// folds, and the activity level - real-time Kp needs the internet, so the page lets you set it.
import * as THREE from 'three';
import { logDepth, GLSL_NOISE, clamp, smoothstep } from '../util.js';
import { ll2v } from '../magnetic.js';

const NM = 180, HS = [90, 100, 110, 125, 150, 195, 260, 340], NH = HS.length, TAU = Math.PI * 2;
const CURTAINS = [{ hemi: 1, off: -1.3, ph: 0.0 }, { hemi: 1, off: 1.3, ph: 2.1 }, { hemi: -1, off: -1.3, ph: 1.0 }, { hemi: -1, off: 1.3, ph: 3.3 }];
const NV = (NM + 1) * NH;

const VERT = /* glsl */ `
attribute float aH; attribute float aMu; attribute float aI;
varying float vH, vMu, vI; varying vec3 vV;
void main(){ vH = aH; vMu = aMu; vI = aI; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; gl_Position = projectionMatrix * mv; }`;
const FRAG = /* glsl */ `${GLSL_NOISE}
uniform float uTime, uGain, uLand; uniform vec3 uUpV;
varying float vH, vMu, vI; varying vec3 vV;
void main(){
  float prof = smoothstep(86.0, 100.0, vH) * exp(-max(vH - 108.0, 0.0) / 40.0);
  float gw = smoothstep(88.0, 104.0, vH) * (1.0 - smoothstep(150.0, 210.0, vH));
  float rw = smoothstep(140.0, 230.0, vH);
  float pw = 1.0 - smoothstep(96.0, 112.0, vH);
  vec3 col = vec3(0.10, 1.0, 0.40) * gw + vec3(0.95, 0.10, 0.18) * rw * 0.55 + vec3(0.80, 0.22, 0.85) * pw * 0.6;
  float n1 = vnoise(vec3(vMu * 420.0, uTime * 0.35, 0.3));
  float n2 = vnoise(vec3(vMu * 97.0 - uTime * 0.08, uTime * 0.12, 1.7));
  float rays = smoothstep(0.12, 0.95, n1 * 0.62 + n2 * 0.72);
  float fold = 0.45 + 1.0 * n2;
  vec3 vd = vV * inversesqrt(max(dot(vV, vV), 1e-30));
  vec3 dx = dFdx(vV), dy = dFdy(vV);
  float ax = length(dx), ay = length(dy);
  vec3 cr = (ax > 1e-12 && ay > 1e-12) ? cross(dx / ax, dy / ay) : vec3(0.0);
  float cl = length(cr);
  vec3 nrm = cl > 1e-3 ? cr / cl : vd;                          // degenerate derivatives: fall back to "face-on"
  float facing = clamp(abs(dot(nrm, vd)), 0.0, 1.0);
  float gain = mix(0.85, 0.32, uLand) + 1.05 * pow(clamp(1.0 - facing, 0.0, 1.0), 1.5);
  float el = dot(vd, uUpV);                          // seen through the thick air near the horizon, light is dimmed and reddened
  float hz = mix(1.0, smoothstep(-0.02, 0.20, el), uLand);
  vec3 tint = mix(vec3(1.0), vec3(1.0, 0.82, 0.7), uLand * (1.0 - smoothstep(0.0, 0.3, el)));
  gl_FragColor = vec4(col * tint * prof * rays * fold * gain * vI * uGain * hz, 1.0);
}`;

export class Aurora {
  constructor(model) {
    this.m = model;
    const n = CURTAINS.length * NV;
    this.pos = new Float32Array(n * 3); this.aH = new Float32Array(n); this.aMu = new Float32Array(n); this.aI = new Float32Array(n);
    const idx = [];
    CURTAINS.forEach((c, k) => {
      for (let i = 0; i < NM; i++) for (let j = 0; j < NH - 1; j++) {
        const a = k * NV + i * NH + j, b = a + NH, c2 = a + 1, d = b + 1;
        idx.push(a, b, c2, b, d, c2);
        }
      for (let i = 0; i <= NM; i++) for (let j = 0; j < NH; j++) { const v = k * NV + i * NH + j; this.aH[v] = HS[j]; this.aMu[v] = i / NM + k * 0.37; }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aH', new THREE.BufferAttribute(this.aH, 1)); g.setAttribute('aMu', new THREE.BufferAttribute(this.aMu, 1));
    g.setAttribute('aI', new THREE.BufferAttribute(this.aI, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.u = { uTime: { value: 0 }, uGain: { value: 1 }, uLand: { value: 0 }, uUpV: { value: new THREE.Vector3(0, 1, 0) } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, ...logDepth(VERT, FRAG), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = -12;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    this._u = new THREE.Vector3(); this._p = new THREE.Vector3(); this._cs = new Float32Array(NM + 1 * 2);
  }

  // pole: geomagnetic north pole {lat, lon}; sunEF: unit Sun direction in the Earth-fixed scene frame
  update(ctx, S, pole, sunEF) {
    if (!S.aurora || ctx.cond.day > 0.97 && ctx.zoom > 0.8) { this.mesh.visible = false; return; }
    const kp = clamp(S.kp, 0, 9), t = ctx.time;
    const zm = ll2v(pole.lat, pole.lon);                                   // magnetic axis, standard axes (z = geographic north)
    let x0 = [-zm[1], zm[0], 0]; const l0 = Math.hypot(x0[0], x0[1]) || 1; x0 = [x0[0] / l0, x0[1] / l0, 0];
    const y0 = [zm[1] * x0[2] - zm[2] * x0[1], zm[2] * x0[0] - zm[0] * x0[2], zm[0] * x0[1] - zm[1] * x0[0]];
    const s = [sunEF.x, -sunEF.z, sunEF.y];                                 // scene -> standard axes
    const muSun = Math.atan2(s[0] * y0[0] + s[1] * y0[1] + s[2] * y0[2], s[0] * x0[0] + s[1] * x0[1] + s[2] * x0[2]);
    const lc = Math.max(46, 72 - 1.2 * kp), base = 0.25 + 0.75 * Math.pow(kp / 9, 0.8);
    const sunV = sunEF;
    for (let k = 0; k < CURTAINS.length; k++) {
      const C = CURTAINS[k];
      for (let i = 0; i <= NM; i++) {
        const mu = (i / NM) * TAU, dmu = mu - muSun, night = -Math.cos(dmu);     // +1 at magnetic midnight
        const lam = (lc - 2.5 * night + C.off + 0.5 * Math.sin(5 * mu + t * 0.3 + C.ph) + 0.25 * Math.sin(13 * mu - t * 0.5 + 2 * C.ph)) * Math.PI / 180;
        const cl = Math.cos(lam), sl = Math.sin(lam) * C.hemi, cm = Math.cos(mu), sm = Math.sin(mu);
        const px = cl * (cm * x0[0] + sm * y0[0]) + sl * zm[0], py = cl * (cm * x0[1] + sm * y0[1]) + sl * zm[1], pz = cl * (cm * x0[2] + sm * y0[2]) + sl * zm[2];
        const u = this._u.set(px, pz, -py);                                   // standard -> scene axes
        const night2 = 0.5 + 0.5 * Math.cos(dmu - Math.PI - 0.35);
        const dark = smoothstep(0.06, -0.30, u.dot(sunV));
        const I = base * (0.18 + 0.82 * Math.pow(night2, 1.3)) * dark;
        for (let j = 0; j < NH; j++) {
          const v = k * NV + i * NH + j;
          this.m.earthPoint(u, HS[j], this._p);
          const fin = Number.isFinite(this._p.x + this._p.y + this._p.z);        // a bad vertex must never reach the GPU
          this.pos[v * 3] = fin ? this._p.x : 0; this.pos[v * 3 + 1] = fin ? this._p.y : 0; this.pos[v * 3 + 2] = fin ? this._p.z : 0;
          this.aI[v] = fin && Number.isFinite(I) ? I : 0;
        }
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aI.needsUpdate = true;
    this.u.uTime.value = t;
    // daylight at the observer's sky washes it out; the moon a little
    this.u.uGain.value = 1.35 * (1 - ctx.cond.day);
    this.u.uLand.value = ctx.cond.atmo;
    this.mesh.visible = S.aurora && this.u.uGain.value > 0.01;
  }
}
