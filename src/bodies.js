// Sun, Moon and planets.
//  - Sun  : billboard with a physically-sized disc and a wide HDR corona.
//  - Moon : billboard rendered as a lit sphere (Lommel-Seeliger shading) with procedural maria and
//           craters in selenographic coordinates; the phase comes from the real Sun-Moon-observer geometry,
//           so every cosmology that places them gets a phase for free.
//  - Wanderers: planets as star-like points (same photometry as the catalogue stars).
import * as THREE from 'three';
import { logDepth, GLSL_NOISE } from './util.js';
import { starMaterial } from './sky.js';

const BILLBOARD_VERT = /* glsl */ `
uniform vec3 uCenter; uniform float uSize;
varying vec2 vP; varying float vElev;
uniform vec3 uObs, uUp;
void main(){
  vP = position.xy;
  vec4 mv = viewMatrix * vec4(uCenter, 1.0);
  vElev = dot(normalize(uCenter - uObs), uUp);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const SUN_FRAG = /* glsl */ `
uniform float uCore, uInt, uAtmo, uGlow; uniform vec3 uColor;
varying vec2 vP; varying float vElev;
void main(){
  float r = length(vP);
  if (r > 1.0) discard;
  float rr = r / uCore;                                  // 1.0 at the solar limb
  float disc = smoothstep(1.02, 0.97, rr);
  float limb = 1.0 - 0.45 * (1.0 - sqrt(max(1.0 - min(rr, 1.0) * min(rr, 1.0), 0.0)));
  float corona = 0.10 / (0.35 + rr * rr) + 0.9 * exp(-rr * 0.55);
  float outer = exp(-r * 5.5) * 0.9;
  float below = mix(1.0, smoothstep(-0.06, 0.01, vElev), uAtmo);
  vec3 c = uColor * (disc * limb * 38.0 + (corona * 1.4 + outer * 2.0) * uGlow);
  gl_FragColor = vec4(c * below * uInt, 1.0);
}`;

const MOON_FRAG = /* glsl */ `
uniform float uCore, uInt, uAtmo, uHalo;
uniform vec3 uLight, uBX, uBY, uBZ;                       // view-space light dir and selenographic axes
varying vec2 vP; varying float vElev;
${GLSL_NOISE}
float blob(vec2 lonlat, vec2 c, vec2 r, float soft){
  vec2 d = (lonlat - c) / r; return smoothstep(1.0 + soft, 1.0 - soft, length(d));
}
float cell(vec3 p, out float rim){                        // Worley-ish crater field
  vec3 i = floor(p), f = fract(p); float d1 = 9.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(i + g);
    d1 = min(d1, length(g + o - f));
  }
  rim = smoothstep(0.30, 0.18, d1) - 0.7 * smoothstep(0.16, 0.0, d1);
  return d1;
}
void main(){
  float r = length(vP);
  float rr = r / uCore;
  float halo = uHalo * (exp(-r * 6.0) * 0.55 + exp(-r * 16.0) * 0.5);
  float below = mix(1.0, smoothstep(-0.06, 0.01, vElev), uAtmo);
  vec3 col = vec3(0.0);
  if (rr < 1.0) {
    vec3 n = vec3(vP / uCore, 0.0); n.z = sqrt(max(1.0 - dot(n.xy, n.xy), 0.0));
    vec3 b = vec3(dot(n, uBX), dot(n, uBY), dot(n, uBZ));         // body-fixed unit normal
    vec2 ll = vec2(degrees(atan(b.x, b.z)), degrees(asin(clamp(b.y, -1.0, 1.0))));
    vec3 q = b * 6.0 + vec3(1.7, 3.1, 5.3);
    float warp = fbm(q * 0.9) - 0.5;
    ll += warp * vec2(5.0, 4.0);
    float mare = 0.0;
    mare = max(mare, blob(ll, vec2(-16.0, 33.0), vec2(20.0, 14.0), 0.18));      // Imbrium
    mare = max(mare, blob(ll, vec2(18.0, 28.0), vec2(11.0, 10.0), 0.2));        // Serenitatis
    mare = max(mare, blob(ll, vec2(31.0, 9.0), vec2(15.0, 10.5), 0.2));         // Tranquillitatis
    mare = max(mare, blob(ll, vec2(59.0, 17.0), vec2(8.0, 6.5), 0.22));         // Crisium
    mare = max(mare, blob(ll, vec2(51.0, -7.0), vec2(9.0, 10.0), 0.22));        // Fecunditatis
    mare = max(mare, blob(ll, vec2(34.0, -15.0), vec2(5.5, 5.5), 0.25));        // Nectaris
    mare = max(mare, blob(ll, vec2(-16.0, -21.0), vec2(11.0, 8.0), 0.2));       // Nubium
    mare = max(mare, blob(ll, vec2(-39.0, -24.0), vec2(6.0, 6.0), 0.25));       // Humorum
    mare = max(mare, blob(ll, vec2(-23.0, -10.0), vec2(6.0, 5.0), 0.22));       // Cognitum
    mare = max(mare, blob(ll, vec2(3.0, 13.0), vec2(5.0, 4.5), 0.25));          // Vaporum
    mare = max(mare, blob(ll, vec2(-6.0, 55.0), vec2(36.0, 5.0), 0.3));         // Frigoris
    mare = max(mare, 0.92 * blob(ll, vec2(-57.0, 17.0), vec2(26.0, 22.0), 0.35)); // Procellarum
    mare = max(mare, 0.8 * blob(ll, vec2(-18.0, 55.0), vec2(6.0, 4.0), 0.3));
    float rim; float d1 = cell(b * 11.0, rim);
    float rim2; float d2 = cell(b * 26.0 + 4.0, rim2);
    float land = fbm(b * 5.0 + 9.0);
    float alb = mix(0.30, 0.092, mare * (0.8 + 0.2 * land));
    alb *= 0.88 + 0.26 * land;
    alb *= 1.0 + 0.10 * rim + 0.07 * rim2;
    // Tycho and its rays
    vec2 ty = ll - vec2(-11.0, -43.0);
    alb += 0.20 * exp(-dot(ty, ty) / 4.0) + 0.06 * exp(-length(ty) / 40.0) * (0.5 + 0.5 * sin(atan(ty.y, ty.x) * 9.0 + fbm(b * 3.0) * 6.0));
    float mu0 = dot(n, uLight), mu = max(n.z, 0.02);
    float lit = mu0 > 0.0 ? mu0 / (mu0 + mu) * 2.0 : 0.0;                       // Lommel-Seeliger
    lit *= smoothstep(-0.02, 0.10, mu0);
    float earthshine = 0.0035 * (0.5 + 0.5 * n.z);
    col = vec3(1.0, 0.97, 0.92) * alb * (lit * 4.6 * 3.2 + earthshine * 4.0);
    col *= smoothstep(1.0, 0.985, rr);
  }
  vec3 hc = vec3(0.75, 0.85, 1.0) * halo;
  gl_FragColor = vec4((col + hc) * below * uInt, 1.0);
}`;

function billboardMat(vs, fs, u) {
  return new THREE.ShaderMaterial({
    uniforms: u, ...logDepth(vs, fs), transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
const QUAD = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  return g;
})();

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Bodies {
  // sharedU: the SkyLayer uniform block (uObs, uUp, uAtmo, uMagLimit... shared so extinction matches)
  constructor(sharedU) {
    this.u = sharedU;
    this.group = new THREE.Group(); this.group.name = 'bodies';

    const common = () => ({
      uCenter: { value: new THREE.Vector3() }, uSize: { value: 1 }, uCore: { value: 0.1 }, uInt: { value: 1 },
      uObs: sharedU.uObs, uUp: sharedU.uUp, uAtmo: sharedU.uAtmo,
    });
    this.sunU = { ...common(), uGlow: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.93, 0.80) } };
    this.sun = new THREE.Mesh(QUAD, billboardMat(BILLBOARD_VERT, SUN_FRAG, this.sunU));
    this.sun.frustumCulled = false; this.sun.renderOrder = -18;

    this.moonU = {
      ...common(), uHalo: { value: 0.0 }, uLight: { value: new THREE.Vector3(1, 0, 0) },
      uBX: { value: new THREE.Vector3(1, 0, 0) }, uBY: { value: new THREE.Vector3(0, 1, 0) }, uBZ: { value: new THREE.Vector3(0, 0, 1) },
    };
    this.moon = new THREE.Mesh(QUAD, billboardMat(BILLBOARD_VERT, MOON_FRAG, this.moonU));
    this.moon.frustumCulled = false; this.moon.renderOrder = -17;

    // planets as points (positions are world space; group transform stays identity)
    this.planetList = [];
    const n = 8;
    this.pPos = new Float32Array(n * 3); this.pMag = new Float32Array(n); this.pCol = new Float32Array(n * 3); this.pSeed = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(this.pMag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.pSeed, 1));
    this.planets = new THREE.Points(g, starMaterial(sharedU));
    this.planets.frustumCulled = false; this.planets.renderOrder = -16;
    g.setDrawRange(0, 0);

    this.group.add(this.sun, this.moon, this.planets);
  }

  // Place the Sun. world position `pos`, physical radius `radius` (world units), min on-screen radius in px.
  setSun(pos, radius, camera, viewportH, minPx = 3) {
    const dist = pos.distanceTo(camera.position);
    const pxPerRad = viewportH / (2 * Math.tan(camera.fov * Math.PI / 360));
    const r = Math.max(radius, dist * minPx / pxPerRad);
    this.sunU.uCenter.value.copy(pos);
    const k = 16;
    this.sunU.uSize.value = r * k; this.sunU.uCore.value = 1 / k;
  }

  // Place the Moon. earthCenter: where the Moon's near side points (used for orientation).
  // northWorld: direction of lunar north (celestial north).
  setMoon(pos, radius, sunPos, earthCenter, camera, viewportH, halo, minPx = 3) {
    const dist = pos.distanceTo(camera.position);
    const pxPerRad = viewportH / (2 * Math.tan(camera.fov * Math.PI / 360));
    const r = Math.max(radius, dist * minPx / pxPerRad);
    const k = 6;
    this.moonU.uCenter.value.copy(pos);
    this.moonU.uSize.value = r * k; this.moonU.uCore.value = 1 / k;
    this.moonU.uHalo.value = halo;
    const V = camera.matrixWorldInverse;
    const toView = (w, out) => out.copy(w).transformDirection(V);
    // light direction from Moon toward Sun
    _a.copy(sunPos).sub(pos).normalize(); toView(_a, this.moonU.uLight.value);
    // selenographic axes: z toward Earth, y celestial north, x lunar east = sky west
    const bz = _b.copy(earthCenter).sub(pos).normalize();
    const north = _c.set(0, 1, 0);
    const by = north.clone().addScaledVector(bz, -north.dot(bz)).normalize();
    const bx = by.clone().cross(bz);                          // y x z = x
    toView(bx, this.moonU.uBX.value); toView(by, this.moonU.uBY.value); toView(bz, this.moonU.uBZ.value);
  }

  setPlanets(list) {            // [{pos:Vector3, mag, color:[r,g,b]}]
    const n = Math.min(list.length, 8);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      this.pPos[i * 3] = p.pos.x; this.pPos[i * 3 + 1] = p.pos.y; this.pPos[i * 3 + 2] = p.pos.z;
      this.pMag[i] = p.mag;
      this.pCol[i * 3] = p.color[0]; this.pCol[i * 3 + 1] = p.color[1]; this.pCol[i * 3 + 2] = p.color[2];
      this.pSeed[i] = (i * 0.37) % 1;
    }
    const g = this.planets.geometry;
    g.attributes.position.needsUpdate = g.attributes.aMag.needsUpdate = g.attributes.aColor.needsUpdate = true;
    g.setDrawRange(0, n);
  }
}
