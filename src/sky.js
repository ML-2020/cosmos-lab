// The sky as data: real stars, constellations (Western + Chinese), Milky Way, grids.
// A SkyLayer is geometry-agnostic. The cosmology decides WHERE a point of the
// celestial sphere (ra, dec) goes via place(ra, dec, out): onto an infinitely
// distant sphere, onto a finite dome, onto a hollow shell...
//
// Two child groups share the parent transform:
//   j2000  : catalogue directions (stars, Milky Way, constellations), matrix = precession to date
//   ofdate : coordinate grids tied to the true pole/equator of date
import * as THREE from 'three';
import { STARS, NAMED, WEST, CN, DSO } from './data.js';
import { resolveGuide } from './guide.js';
import mwURI from './generated/mwgal.js';
import { eqToVec, D2R, OBLIQUITY } from './astro.js';
import { bvToRGB, logDepth, GLSL_NOISE } from './util.js';

// Perspective "vanishing" remap used by the flat-earth model: seen from the observer, a point at height h and
// horizontal distance d keeps its azimuth but its altitude is re-measured so that it reaches the horizon at the
// vanishing distance L (altitude it would have at L is subtracted, the rest stretched back to 90 deg).
// uPatch.x = strength (0 = raw geometry, as in the overview), uPatch.y = L in model units.  Needs uObs, uUp.
const PERSPECTIVE = /* glsl */ `
uniform vec2 uPatch;
vec4 skyWorld(vec3 p){
  vec4 wp = modelMatrix * vec4(p, 1.0);
  if (uPatch.x > 0.001) {
    vec3 v = wp.xyz - uObs;
    float h = dot(v, uUp);
    vec3 hv = v - uUp * h;
    float dh = length(hv);
    float e = atan(h, dh);
    float eL = atan(h, uPatch.y);
    float e2 = e >= eL ? (e - eL) / (1.0 - eL / 1.5707963)
                       : -1.5707963 * smoothstep(0.0, 0.2, (dh - uPatch.y) / uPatch.y);   // beyond L it has vanished
    e = mix(e, e2, uPatch.x);
    vec3 hd = dh > 1e-9 ? hv / dh : vec3(0.0);
    wp.xyz = uObs + (hd * cos(e) + uUp * sin(e)) * length(v);
  }
  return wp;
}
`;

const COMMON_BASE = /* glsl */ `
uniform float uPix, uSize, uTime, uDay, uAtmo, uMagLimit, uSpan, uInt, uTrailFade, uBright, uK;
uniform vec3 uObs, uUp;
uniform vec3 uCtr; uniform float uShellFade;
float airmassAt(float el){ return 1.0 / max(el + 0.025 * exp(-11.0 * el), 0.03); }
// Seen from outside the celestial shell the near hemisphere is veiled so the inside stays readable.
float shellFade(vec3 wp){
  if (uShellFade < 0.001) return 1.0;
  float nr = dot(normalize(wp - uCtr), normalize(-uCtr));
  return 1.0 - uShellFade * 0.80 * smoothstep(-0.05, 0.75, nr);
}
`;
const COMMON = COMMON_BASE + PERSPECTIVE;          // vertex shaders (skyWorld needs modelMatrix)

const STAR_VERT = /* glsl */ `${COMMON}
attribute float aMag; attribute vec3 aColor; attribute float aSeed;
varying vec3 vColor; varying float vAlpha; varying float vBright; varying float vHdr;
void main(){
  vec4 wp = skyWorld(position);
  vec3 dir = normalize(wp.xyz - uObs);
  float el = dot(dir, uUp);
  float m = aMag + uK * airmassAt(el) * uAtmo + uDay * 9.0 - uBright;
  float vis = smoothstep(uMagLimit + 0.7, uMagLimit - 0.5, m);
  float horizon = mix(1.0, smoothstep(-0.03, 0.02, el), uAtmo);
  float tw = 1.0 + uAtmo * 0.14 * sin(uTime * (6.0 + aSeed * 8.0) + aSeed * 61.0) * (1.0 + 2.5 * (1.0 - clamp(el * 4.0, 0.0, 1.0)));
  float flux = pow(10.0, -0.4 * m) * tw;
  float k = clamp(flux * 3.2, 0.0, 1.0);
  float size = uSize * (1.7 + 12.0 * pow(k, 0.40));
  vHdr = 0.9 + 5.5 * k;
  gl_PointSize = size * uPix;
  vec3 warm = mix(aColor, aColor * vec3(1.0, 0.82, 0.66), clamp(1.0 - el * 3.0, 0.0, 1.0) * uAtmo);
  vColor = warm;
  vBright = smoothstep(1.6, -0.6, aMag) * (1.0 - uDay);
  vAlpha = vis * horizon * clamp(0.28 + flux * 6.0, 0.0, 1.0) * shellFade(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor; varying float vAlpha; varying float vBright; varying float vHdr;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 > 1.0 || vAlpha < 0.003) discard;
  float core = exp(-d2 * 15.0);
  float halo = exp(-d2 * 3.4) * 0.30;
  float sx = exp(-abs(p.y) * 46.0) * exp(-abs(p.x) * 2.6);
  float sy = exp(-abs(p.x) * 46.0) * exp(-abs(p.y) * 2.6);
  float spike = (sx + sy) * 0.5 * vBright;
  float a = (core + halo + spike) * vAlpha;
  vec3 col = mix(vec3(1.0), vColor, 0.55 + 0.45 * (1.0 - core));
  gl_FragColor = vec4(col * vHdr, a);
}`;

// Trails: each bright star swept about the pole axis (Y). uSpan > 0 sweeps into the past, < 0 into the future.
const TRAIL_VERT = /* glsl */ `${COMMON}
attribute float aT; attribute float aMag; attribute vec3 aColor;
varying vec3 vColor; varying float vA;
void main(){
  float th = uSpan * aT;
  float c = cos(th), s = sin(th);
  vec3 p = vec3(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
  vec4 wp = skyWorld(p);
  vec3 dir = normalize(wp.xyz - uObs);
  float el = dot(dir, uUp);
  float m = aMag + uK * airmassAt(el) * uAtmo + uDay * 9.0 - uBright;
  float vis = smoothstep(uMagLimit + 0.4, uMagLimit - 0.6, m);
  float horizon = mix(1.0, smoothstep(-0.03, 0.02, el), uAtmo);
  float flux = pow(10.0, -0.4 * m);
  vColor = aColor;
  vA = vis * horizon * mix(1.0, pow(1.0 - aT, 1.3), uTrailFade) * clamp(0.15 + flux * 3.2, 0.0, 0.8) * shellFade(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const TRAIL_FRAG = /* glsl */ `
varying vec3 vColor; varying float vA;
void main(){ if (vA < 0.004) discard; gl_FragColor = vec4(mix(vec3(1.0), vColor, 0.7), vA); }`;

const MW_VERT = /* glsl */ `
attribute vec3 aDir;
uniform vec3 uObs, uUp;
${PERSPECTIVE}
varying vec3 vDir; varying vec3 vW;
void main(){
  vDir = aDir;
  vec4 wp = skyWorld(position);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const MW_FRAG = /* glsl */ `${COMMON_BASE}
uniform sampler2D uMW; uniform mat3 uGal;
varying vec3 vDir; varying vec3 vW;
${GLSL_NOISE}
void main(){
  vec3 q = normalize(vDir);
  vec3 g = uGal * q;                                   // galactic axes: x -> centre, z -> north pole
  float l = atan(g.y, g.x), b = asin(clamp(g.z, -1.0, 1.0));
  vec3 tex = texture2D(uMW, vec2(l / 6.2831853 + 0.5, b / 3.14159265 + 0.5)).rgb;
  float lum = tex.r, dustMap = tex.g, warm = tex.b;
  if (lum < 0.004 && dustMap < 0.004) discard;

  // algorithmic detail, aligned with the galactic frame so structure follows the plane
  vec3 gp = vec3(g.x, g.y, g.z * 2.3);
  float n1 = fbm(gp * 7.0);
  float n2 = fbm(gp * 21.0 + 3.0);
  float n3 = fbm(gp * 66.0 + 11.0);
  float cloud = lum * (0.50 + 1.0 * n1) * (0.72 + 0.62 * n2);
  float dust = clamp(dustMap * (0.45 + 1.15 * fbm(gp * 15.0 + 5.0 + n1 * 1.5)), 0.0, 1.0);
  dust = smoothstep(0.10, 0.80, dust);
  float dens = cloud * (1.0 - 0.88 * dust);
  dens += smoothstep(0.60, 0.95, n3) * lum * 0.28 * (1.0 - dust);

  // unresolved starfield: round pin-pricks in 3D cells, density follows the band
  vec3 cp = g * 340.0;
  vec3 ci = floor(cp), cf = fract(cp);
  vec3 jit = hash33(ci);
  float dd = length(cf - (0.25 + 0.5 * jit));
  float sparkle = smoothstep(0.34, 0.0, dd) * step(1.0 - 0.55 * lum * (1.0 - dust), hash13(ci + 19.7));
  dens += sparkle * 0.55 * (0.4 + lum);

  vec3 cool = vec3(0.56, 0.68, 1.0), hot = vec3(1.0, 0.78, 0.55), rust = vec3(0.90, 0.48, 0.30);
  vec3 col = mix(cool, hot, smoothstep(0.15, 0.85, warm));
  col = mix(col, rust, dust * 0.35);

  vec3 dir = normalize(vW - uObs);
  float el = dot(dir, uUp);
  float horizon = mix(1.0, smoothstep(-0.02, 0.10, el), uAtmo);
  float haze = mix(1.0, 0.55 + 0.45 * smoothstep(0.0, 0.35, el), uAtmo);
  float a = pow(clamp(dens, 0.0, 2.0), 1.1) * 0.40 * uInt * pow(10.0, 0.4 * uBright * 0.5) * (1.0 - clamp(uDay * 1.4, 0.0, 1.0)) * horizon * haze * shellFade(vW);
  gl_FragColor = vec4(col * a, a);
}`;

const LINE_VERT = /* glsl */ `
uniform vec3 uObs, uUp; uniform float uAtmo, uDay;
uniform vec3 uCtr; uniform float uShellFade;
${PERSPECTIVE}
attribute float aE;
varying float vA;
void main(){
  vec4 wp = skyWorld(position);
  float el = dot(normalize(wp.xyz - uObs), uUp);
  float sf = 1.0;
  if (uShellFade > 0.001) sf = 1.0 - uShellFade * 0.80 * smoothstep(-0.05, 0.75, dot(normalize(wp.xyz - uCtr), normalize(-uCtr)));
  vA = aE * mix(1.0, smoothstep(-0.02, 0.05, el), uAtmo) * (1.0 - clamp(uDay * 1.3, 0.0, 1.0)) * sf;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LINE_FRAG = /* glsl */ `
uniform float uAlpha; uniform vec3 uCol; varying float vA;
void main(){ gl_FragColor = vec4(uCol, uAlpha * vA); }`;

const DSO_VERT = /* glsl */ `${COMMON}
attribute float aSize; attribute float aI; attribute vec3 aColor;
uniform float uPxPerDeg;
varying float vI; varying vec3 vC;
void main(){
  vec4 wp = skyWorld(position);
  float el = dot(normalize(wp.xyz - uObs), uUp);
  vI = aI * mix(1.0, smoothstep(-0.02, 0.06, el), uAtmo) * (1.0 - clamp(uDay * 1.4, 0.0, 1.0)) * shellFade(wp.xyz);
  vC = aColor;
  gl_PointSize = clamp(aSize * uPxPerDeg, 6.0, 420.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DSO_FRAG = /* glsl */ `
varying float vI; varying vec3 vC;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0; float d2 = dot(p, p);
  if (d2 > 1.0) discard;
  float a = (exp(-d2 * 5.0) * 0.8 + exp(-d2 * 18.0) * 0.5) * vI;
  gl_FragColor = vec4(vC * a, a);
}`;

function mat(vs, fs, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms, ...logDepth(vs, fs),
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, ...extra,
  });
}

// Equatorial J2000 (scene axes) -> galactic axes rows, built from the IAU definition.
function galacticMatrix() {
  const d2r = D2R;
  const gz = [Math.cos(27.12825 * d2r) * Math.cos(192.85948 * d2r), Math.cos(27.12825 * d2r) * Math.sin(192.85948 * d2r), Math.sin(27.12825 * d2r)];
  const ra0 = 266.40499 * d2r, de0 = -28.93617 * d2r;
  let gx = [Math.cos(de0) * Math.cos(ra0), Math.cos(de0) * Math.sin(ra0), Math.sin(de0)];
  const dot = gx[0] * gz[0] + gx[1] * gz[1] + gx[2] * gz[2];
  gx = gx.map((v, i) => v - gz[i] * dot);
  const n = Math.hypot(...gx); gx = gx.map((v) => v / n);
  const gy = [gz[1] * gx[2] - gz[2] * gx[1], gz[2] * gx[0] - gz[0] * gx[2], gz[0] * gx[1] - gz[1] * gx[0]];
  const toScene = (r) => [r[0], r[2], -r[1]];   // std (x,y,z) -> scene (x,z,-y)
  const m = new THREE.Matrix3();
  m.set(...toScene(gx), ...toScene(gy), ...toScene(gz));
  return m;
}

export const starMaterial = (u) => mat(STAR_VERT, STAR_FRAG, u);

export class SkyLayer {
  // place(ra, dec, out): Vector3 in the layer's local frame.
  constructor({ place, trailStars = 2400, spherical = true }) {
    this.place = place;
    this.spherical = spherical;
    this.group = new THREE.Group(); this.group.name = 'sky';
    this.j2000 = new THREE.Group(); this.j2000.matrixAutoUpdate = false;
    this.ofdate = new THREE.Group();
    this.group.add(this.j2000, this.ofdate);

    this.u = {
      uTime: { value: 0 }, uPix: { value: 1 }, uSize: { value: 1 },
      uDay: { value: 0 }, uAtmo: { value: 0 }, uMagLimit: { value: 6.4 }, uK: { value: 0.24 },
      uObs: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSpan: { value: 0 }, uInt: { value: 1 }, uBright: { value: 0 }, uTrailFade: { value: 0 },
      uGal: { value: galacticMatrix() }, uPxPerDeg: { value: 20 },
      uCtr: { value: new THREE.Vector3(0, 0, 1e6) }, uShellFade: { value: 0 }, uPatch: { value: new THREE.Vector2(0, 1.6) },
    };
    const tex = new THREE.TextureLoader().load(mwURI, () => this.onTexture && this.onTexture());
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    this.u.uMW = { value: tex };

    this.#buildMilkyWay();
    this.#buildStars(trailStars);
    this.west = this.#buildLines(WEST, 'west', [0.52, 0.68, 1.0], 0.34);
    this.cn = this.#buildLines(CN, 'cn', [1.0, 0.74, 0.42], 0.34);
    const G = resolveGuide();
    this.guide = this.#buildLines(G.asterisms, 'guide', [1.0, 0.86, 0.52], 0.62); this.guide.userData.a0 = 0.62; this.guide.visible = false;
    this.pointer = this.#buildLines(G.pointer, 'pointer', [0.55, 0.95, 1.0], 0.8); this.pointer.userData.a0 = 0.8; this.pointer.visible = false;
    this.guideAnchors = G.anchors.map((a) => ({ kind: a.kind, text: a.text, idx: a.idx, pos: this.place(a.ra, a.dec, new THREE.Vector3()), mag: 0 }));
    this.cn.visible = false;
    this.#buildGrids();
    this.#buildDSO();
  }

  // ---- milky way
  #buildMilkyWay() {
    const W = 144, H = 72, pos = [], dirs = [], idx = [];
    const v = new THREE.Vector3(), d = new THREE.Vector3();
    for (let j = 0; j <= H; j++) {
      const dec = 90 - (j / H) * 180;
      for (let i = 0; i <= W; i++) {
        const ra = (i / W) * 360;
        this.place(ra, dec, v);
        pos.push(v.x, v.y, v.z);
        eqToVec(ra, dec, 1, d); dirs.push(d.x, d.y, d.z);
      }
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = j * (W + 1) + i, b = a + 1, c = a + W + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(dirs, 3));
    g.setIndex(idx);
    this.milky = new THREE.Mesh(g, mat(MW_VERT, MW_FRAG, this.u, { side: THREE.DoubleSide }));
    this.milky.frustumCulled = false;
    this.milky.renderOrder = -30;
    this.j2000.add(this.milky);
  }

  // ---- stars + trails
  #buildStars(trailCount) {
    const n = STARS.n;
    const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3), seed = new Float32Array(n);
    const v = new THREE.Vector3(), c = [0, 0, 0];
    this.starPos = pos;
    for (let i = 0; i < n; i++) {
      this.place(STARS.ra[i], STARS.dec[i], v);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      mag[i] = STARS.mag(i);
      bvToRGB(STARS.bv(i), c);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      seed[i] = ((i * 2654435761) % 1000) / 1000;
    }
    this.starMag = mag;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.stars = new THREE.Points(g, mat(STAR_VERT, STAR_FRAG, this.u));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -20;
    this.j2000.add(this.stars);

    const N = Math.min(trailCount, n), SEG = 48;
    const tp = new Float32Array(N * SEG * 2 * 3), tt = new Float32Array(N * SEG * 2), tm = new Float32Array(N * SEG * 2), tc = new Float32Array(N * SEG * 2 * 3);
    let k = 0, k3 = 0;
    for (let i = 0; i < N; i++) {
      for (let s = 0; s < SEG; s++) {
        for (const e of [s, s + 1]) {
          tp[k3] = pos[i * 3]; tp[k3 + 1] = pos[i * 3 + 1]; tp[k3 + 2] = pos[i * 3 + 2];
          tc[k3] = col[i * 3]; tc[k3 + 1] = col[i * 3 + 1]; tc[k3 + 2] = col[i * 3 + 2];
          tt[k] = e / SEG; tm[k] = mag[i]; k++; k3 += 3;
        }
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    tg.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    tg.setAttribute('aMag', new THREE.BufferAttribute(tm, 1));
    tg.setAttribute('aColor', new THREE.BufferAttribute(tc, 3));
    this.trails = new THREE.LineSegments(tg, mat(TRAIL_VERT, TRAIL_FRAG, this.u));
    this.trails.frustumCulled = false;
    this.trails.renderOrder = -19;
    this.trails.visible = false;
    this.j2000.add(this.trails);
  }

  // ---- constellation line sets (great-circle tessellated so any place() map bends them correctly)
  #buildLines(set, name, rgb, alpha) {
    const pos = [], ends = [], a = new THREE.Vector3(), t = new THREE.Vector3();
    const ua = new THREE.Vector3(), ub = new THREE.Vector3();
    for (const c of set) for (const line of c.lines) {
      for (let i = 0; i < line.length - 1; i++) {
        eqToVec(line[i][0], line[i][1], 1, ua); eqToVec(line[i + 1][0], line[i + 1][1], 1, ub);
        const ang = ua.angleTo(ub), steps = Math.max(2, Math.ceil(ang / (1.6 * D2R)));
        let prev = null, pe = 0;
        for (let s = 0; s <= steps; s++) {
          t.copy(ua).lerp(ub, s / steps).normalize();
          const dec = Math.asin(t.y) / D2R, ra = ((Math.atan2(-t.z, t.x) / D2R) + 360) % 360;
          this.place(ra, dec, a);
          const x = s / steps, e = Math.min(1, Math.min(x, 1 - x) / 0.10);
          if (prev) { pos.push(prev.x, prev.y, prev.z, a.x, a.y, a.z); ends.push(pe, e); }
          prev = a.clone(); pe = e;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aE', new THREE.Float32BufferAttribute(ends, 1));
    const m = mat(LINE_VERT, LINE_FRAG, { ...this.u, uAlpha: { value: alpha }, uCol: { value: new THREE.Color(...rgb) } });
    const obj = new THREE.LineSegments(g, m);
    obj.frustumCulled = false; obj.renderOrder = -25; obj.name = name;
    this.j2000.add(obj);
    return obj;
  }

  // ---- coordinate grids in the frame of date (equator, ecliptic, galactic plane, hour circles)
  #buildGrids() {
    const mk = (fn, rgb, alpha, name) => {
      const pos = [], ends = [], p = new THREE.Vector3(), q = new THREE.Vector3(), pr = new THREE.Vector3();
      fn((ra, dec, first, last) => {
        this.place(ra, dec, p);
        if (!first) { pos.push(pr.x, pr.y, pr.z, p.x, p.y, p.z); ends.push(1, 1); }
        pr.copy(p);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aE', new THREE.Float32BufferAttribute(ends, 1));
      const m = mat(LINE_VERT, LINE_FRAG, { ...this.u, uAlpha: { value: alpha }, uCol: { value: new THREE.Color(...rgb) } });
      const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.renderOrder = -26; o.name = name; o.visible = false; o.userData.a0 = alpha;
      this.ofdate.add(o);
      return o;
    };
    const STEPS = 180;
    this.equator = mk((cb) => { for (let i = 0; i <= STEPS; i++) cb((i / STEPS) * 360, 0, i === 0); }, [0.35, 0.85, 0.95], 0.55, 'equator');
    this.ecliptic = mk((cb) => {
      const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
      for (let i = 0; i <= STEPS; i++) {
        const l = (i / STEPS) * 2 * Math.PI, x = Math.cos(l), y = Math.sin(l) * c, z = Math.sin(l) * s;
        cb(((Math.atan2(y, x) / D2R) + 360) % 360, Math.asin(z) / D2R, i === 0);
      }
    }, [1.0, 0.82, 0.35], 0.6, 'ecliptic');
    this.grid = mk((cb) => {
      for (let h = 0; h < 24; h += 2) for (let i = 0; i <= 90; i++) cb(h * 15, -90 + (i / 90) * 180, i === 0);
      for (const d of [-60, -30, 30, 60]) for (let i = 0; i <= STEPS; i++) cb((i / STEPS) * 360, d, i === 0);
    }, [0.45, 0.55, 0.9], 0.22, 'grid');
  }

  // ---- showpiece deep-sky objects as soft glows
  #buildDSO() {
    const pos = [], size = [], inten = [], col = [], p = new THREE.Vector3();
    const palette = { gal: [0.75, 0.82, 1.0], neb: [1.0, 0.55, 0.62], oc: [0.7, 0.82, 1.0], gc: [1.0, 0.9, 0.7], pn: [0.5, 1.0, 0.9] };
    this.dsoList = [];
    for (const d of DSO) {
      if (d.k === 'gc' && d.mag === 0) continue;       // galactic centre is a label only
      this.place(d.ra, d.dec, p);
      pos.push(p.x, p.y, p.z);
      const s = Math.max(d.maj, d.min) / 60;           // degrees
      size.push(Math.max(s, 0.4));
      inten.push(Math.min(0.55, 0.12 + 0.07 * (8 - d.mag)));
      col.push(...(palette[d.k] || palette.gal));
      this.dsoList.push(d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aI', new THREE.Float32BufferAttribute(inten, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    this.dso = new THREE.Points(g, mat(DSO_VERT, DSO_FRAG, this.u));
    this.dso.frustumCulled = false; this.dso.renderOrder = -22;
    this.j2000.add(this.dso);
  }

  // local-frame position of catalogue star i
  starLocal(i, out = new THREE.Vector3()) {
    return out.set(this.starPos[i * 3], this.starPos[i * 3 + 1], this.starPos[i * 3 + 2]);
  }

  // Anchors for HTML labels: positions in the j2000 frame (transform with j2000.matrixWorld).
  labelAnchors() {
    const out = [], v = new THREE.Vector3();
    for (const n of NAMED) {
      out.push({ kind: 'star', text: n.zh || n.en, sub: n.zh ? n.en : '', pos: this.starLocal(n.i), mag: STARS.mag(n.i), idx: n.i });
    }
    for (const c of WEST) {
      this.place(c.c[0], c.c[1], v);
      out.push({ kind: 'cons', text: c.zh || c.en, sub: c.en, pos: v.clone(), mag: 99 });
    }
    for (const c of CN) {
      this.place(c.c[0], c.c[1], v);
      out.push({ kind: 'cn', text: c.zh, sub: c.py, pos: v.clone(), mag: 99, rank: c.rank });
    }
    out.push(...this.guideAnchors);
    for (const d of DSO) {
      this.place(d.ra, d.dec, v);
      out.push({ kind: 'dso', text: d.zh, sub: d.en, pos: v.clone(), mag: d.mag });
    }
    return out;
  }
}
