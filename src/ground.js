// The ground under the observer's feet.
//
//  cap    : a polar mesh in the observer's local frame (x = east, y = up, z = south) with exponentially
//           spaced rings from 0.4 m to hundreds of km.  Its curvature is that of the model's ground:
//           sphere of radius R (Earth globe) or flat (flat-earth disc).  It is opaque so it really hides
//           the sky below the horizon, and fades out with altitude to reveal the globe/disc underneath.
//  ridges : layered, hazed hill silhouettes at 12 / 28 / 60 km - the depth cue every night photograph has.
//
// Local-frame vertices keep float32 precision where the eye is, whatever the model's scale.
import * as THREE from 'three';
import { logDepth, GLSL_NOISE } from './util.js';
import { SKY_GLSL } from './atmosphere.js';

const CAP_VERT = /* glsl */ `
varying vec3 vL; varying vec3 vW; varying vec3 vN;
uniform float uR;
void main(){
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  // normal of the sphere (or +y when flat), in local axes then to world
  vec3 nl = uR > 0.0 ? normalize(position + vec3(0.0, uR, 0.0)) : vec3(0.0, 1.0, 0.0);
  vN = normalize(mat3(modelMatrix) * nl);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CAP_FRAG = /* glsl */ `
${SKY_GLSL}
${GLSL_NOISE}
uniform vec3 uTint; uniform float uAlpha, uHazeK, uSea, uPxAng;
uniform vec3 uShift; uniform float uClipR;
varying vec3 vL; varying vec3 vW; varying vec3 vN;
void main(){
  vec3 up = normalize(vN);
  vec3 toC = cameraPosition - vW;
  float dist = length(toC);
  vec3 V = toC / max(dist, 1e-9);
  if (uClipR > 0.0) {                       // flat disc: nothing beyond the ice wall
    vec2 mp = (vW + uShift).xz;
    if (length(mp) > uClipR) discard;
  }
  vec3 N = up;
  vec3 horiz = normalize(-V - up * dot(-V, up) + 1e-6);
  float sunN = dot(N, uSunDir);
  float sunAlt = degrees(asin(clamp(dot(uSunDir, uUp), -1.0, 1.0)));
  float dayF = smoothstep(-6.0, 4.0, sunAlt);

  // albedo relief anchored to the ground (vL): 16 octaves from 160 km down to ~5 m, each fading in only once
  // its cells are several pixels wide, so the surface is crisp from orbit to eye level and never shimmers
  float px = dist * uPxAng;
  float n = 0.0, na = 0.5, nt = 0.0, nf = 40.0;
  for (int i = 0; i < 16; i++) {
    float w = smoothstep(1.5 * px, 6.0 * px, 1.0 / nf);
    n += na * w * (vnoise(vec3(vL.xz * nf, float(i) * 3.7)) - 0.5);
    nt += na; na *= 0.66; nf *= 2.0;
  }
  vec3 alb = uTint * clamp(0.85 + 4.0 * n / nt, 0.25, 2.2);

  vec3 skyAmb = skyRadiance(N);
  vec3 col = alb * skyAmb * 0.85;
  col += alb * max(sunN, 0.0) * (4.4 * uDayGain) * dayF * vec3(1.0, 0.93, 0.82);
  col += alb * vec3(0.78, 0.86, 1.0) * uMoonI * max(dot(N, uMoonDir), 0.0) * 0.11 * (1.0 - dayF) * smoothstep(-0.1, 0.12, dot(uMoonDir, uUp));
  col += alb * uLPCol * uLP * 0.009 * (1.0 - dayF);
  col += alb * 0.00045;                                 // starlight

  // sea: glossy, mirrors the sky radiance (fresnel)
  if (uSea > 0.5) {
    vec3 R = reflect(-V, N);
    float fr = 0.03 + 0.97 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    vec3 refl = skyRadiance(R);
    col = mix(col * 0.25, refl, clamp(fr * 1.4, 0.0, 1.0));
  }

  // aerial haze toward the horizon radiance
  vec3 hd = normalize(horiz + up * 0.015);
  vec3 hz = skyRadiance(hd);
  float f = 1.0 - exp(-dist * uHazeK);
  col = mix(col, hz, f);
  gl_FragColor = vec4(col, uAlpha);
}`;

const RIDGE_VERT = /* glsl */ `
varying vec3 vW; varying float vY;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RIDGE_FRAG = /* glsl */ `
${SKY_GLSL}
uniform float uHaze, uAlpha, uAlbedo;
varying vec3 vW; varying float vY;
void main(){
  vec3 up = uUp;
  vec3 toC = cameraPosition - vW; float dist = length(toC);
  vec3 V = toC / max(dist, 1e-9);
  float sunAlt = degrees(asin(clamp(dot(uSunDir, uUp), -1.0, 1.0)));
  float dayF = smoothstep(-6.0, 4.0, sunAlt);
  vec3 skyAmb = skyRadiance(up) * 0.5 + skyRadiance(normalize(-V - up * dot(-V, up) + up * 0.05)) * 0.3;
  vec3 col = vec3(uAlbedo) * skyAmb;
  col += vec3(uAlbedo) * uMoonI * vec3(0.78, 0.86, 1.0) * 0.05 * (1.0 - dayF) * smoothstep(-0.1, 0.12, dot(uMoonDir, uUp));
  col += vec3(uAlbedo) * uLPCol * uLP * 0.004 * (1.0 - dayF);
  col += vec3(uAlbedo) * 0.0004;
  vec3 hz = skyRadiance(normalize(-V - up * dot(-V, up) + up * 0.02));
  col = mix(col, hz, uHaze);
  gl_FragColor = vec4(col, uAlpha);
}`;

function noise1(i, seed) { const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return noise1(i, seed) * (1 - u) + noise1(i + 1, seed) * u;
}
// periodic fbm over azimuth so the ring closes without a seam
function ridgeProfile(az, seed, octaves = 5) {
  let a = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 2 ** o * 3, p = az / (2 * Math.PI) * f;
    const i = Math.floor(p), t = p - i, u = t * t * (3 - 2 * t);
    const fi = Math.round(f);
    const h0 = noise1(((i % fi) + fi) % fi, seed + o), h1 = noise1((((i + 1) % fi) + fi) % fi, seed + o);
    a += amp * (h0 * (1 - u) + h1 * u); tot += amp; amp *= 0.52;
  }
  return a / tot;
}

export class Ground {
  // curvature: sphere radius in scene units (Infinity / 0 = flat)
  constructor({ curvature = 1, capMax = 0.45, clipR = 0, shared }) {
    this.R = Number.isFinite(curvature) ? curvature : 0;
    this.group = new THREE.Group(); this.group.name = 'ground';
    this.group.matrixAutoUpdate = false;
    this.sky = shared;                                      // skyUniforms()
    this.u = {
      ...shared,
      uR: { value: this.R }, uTint: { value: new THREE.Vector3(0.11, 0.115, 0.10) }, uAlpha: { value: 1 },
      uHazeK: { value: 1 / 0.0050 }, uSea: { value: 0 }, uPxAng: { value: 0.001 },
      uShift: { value: new THREE.Vector3() }, uClipR: { value: clipR },
    };
    this.cap = new THREE.Mesh(this.#capGeometry(capMax), new THREE.ShaderMaterial({
      uniforms: this.u, ...logDepth(CAP_VERT, CAP_FRAG), transparent: true, depthWrite: true, side: THREE.DoubleSide,
    }));
    this.cap.frustumCulled = false; this.cap.renderOrder = -35;
    this.group.add(this.cap);

    this.ridges = [];
    this.ridgeGroup = new THREE.Group();
    const layers = [{ r: 60e3, amp: 0.9, base: 0.2, haze: 0.62, alb: 0.050, seed: 3.1 }, { r: 28e3, amp: 1.2, base: 0.1, haze: 0.38, alb: 0.040, seed: 7.7 }, { r: 12e3, amp: 0.9, base: 0.0, haze: 0.16, alb: 0.030, seed: 11.3 }];
    for (const L of layers) this.#addRidge(L);
    this.group.add(this.ridgeGroup);
    this.setRidges(0.6);
  }

  #capGeometry(sMax) {
    const nR = 80, nS = 120, s0 = 0.4 / 6.371e6;
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    const curved = this.R > 0, R = this.R;
    for (let i = 0; i < nR; i++) {
      const s = s0 * Math.pow(sMax / s0, i / (nR - 1));
      const r = curved ? R * Math.sin(s / R) : s;
      const y = curved ? -R * (1 - Math.cos(s / R)) : 0;
      for (let j = 0; j < nS; j++) {
        const a = (j / nS) * Math.PI * 2;
        pos.push(r * Math.cos(a), y, r * Math.sin(a));
      }
    }
    for (let j = 0; j < nS; j++) idx.push(0, 1 + j, 1 + (j + 1) % nS);
    for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nS; j++) {
      const a = 1 + i * nS + j, b = 1 + i * nS + (j + 1) % nS, c = a + nS, d = b + nS;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  #addRidge(L) {
    const rScene = L.r / 6.371e6, N = 720;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const az = (i / N) * Math.PI * 2;
      const prof = ridgeProfile(az, L.seed);
      const ang = (L.base + L.amp * (0.15 + prof * 1.9)) * Math.PI / 180;
      const x = rScene * Math.cos(az), z = rScene * Math.sin(az);
      pos.push(x, -rScene * 0.012, z, x, rScene * Math.tan(ang), z);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.userData.amp = 1;
    const u = { ...this.sky, uHaze: { value: L.haze }, uAlpha: { value: 1 }, uAlbedo: { value: L.alb } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, ...logDepth(RIDGE_VERT, RIDGE_FRAG), side: THREE.DoubleSide, transparent: true, depthWrite: true }));
    m.frustumCulled = false; m.renderOrder = -36;
    this.ridgeGroup.add(m); this.ridges.push(m);
  }

  // amount 0 (flat plain) .. 1 (mountains); scales the silhouettes vertically
  setRidges(amount) {
    this.ridgeGroup.scale.y = Math.max(amount, 1e-4);
    this.ridgeGroup.visible = amount > 0.01;
    this.ridgeAmount = amount;
  }

  // anchor position (model coords), basis in model coords
  setFrame(pos, east, up, north) {
    const S = north.clone().negate();
    this.group.matrix.makeBasis(east, up, S).setPosition(pos);
    this.group.matrixWorldNeedsUpdate = true;
  }

  // altitude of the camera above the ground in scene units
  setAltitude(h) {
    const a = 1 - THREE.MathUtils.smoothstep(h, 1.2e-3, 9e-3);      // opaque below ~8 km, gone above ~57 km
    this.u.uAlpha.value = a;
    this.cap.visible = a > 0.003;
    const ra = 1 - THREE.MathUtils.smoothstep(h, 2.5e-4, 1.4e-3);
    this.ridgeGroup.children.forEach((m) => { m.material.uniforms.uAlpha.value = ra; });
    if (this.ridgeAmount > 0.01) this.ridgeGroup.visible = ra > 0.003;
  }
}

// Average Blue Marble colour around (lat, lon) -> a believable ground tint.
export function sampleGroundTint(img, lat, lon) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    const W = img.width, H = img.height;
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H, r = Math.max(8, W / 360 * 1.2);
    g.drawImage(img, x - r, y - r, 2 * r, 2 * r, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let R = 0, G = 0, B = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    const n = d.length / 4 * 255;
    const lin = (v) => Math.pow(v / n, 2.2);
    return [lin(R), lin(G), lin(B)];
  } catch (e) { return [0.1, 0.1, 0.09]; }
}
