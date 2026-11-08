// The ground of every cosmology: a globe (day/night, city lights, clouds, glint, atmosphere rim)
// and the flat azimuthal-equidistant disc used by the flat-earth model. Both sample the same
// equirectangular NASA Blue Marble textures; the disc inverts the polar projection per pixel.
import * as THREE from 'three';
import { logDepth, GLSL_NOISE } from './util.js';
import dayURI from './generated/tex_day.js';
import nightURI from './generated/tex_night.js';
import waterURI from './generated/tex_water.js';
import cloudURI from './generated/tex_clouds.js';

const loader = new THREE.TextureLoader();
function tex(uri, srgb) {
  const t = loader.load(uri);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
export const EARTH_TEX = { day: tex(dayURI, true), night: tex(nightURI, true), water: tex(waterURI, false), cloud: tex(cloudURI, false) };

export const earthUniforms = () => ({
  uDay: { value: EARTH_TEX.day }, uNight: { value: EARTH_TEX.night }, uWater: { value: EARTH_TEX.water }, uCloud: { value: EARTH_TEX.cloud },
  uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 }, uSunI: { value: 1 }, uPxAng: { value: 0.001 },
});

// Shared GLSL: sample the surface from an Earth-fixed unit direction.
export const EARTH_GLSL = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D uDay, uNight, uWater, uCloud;
uniform vec3 uSunDir; uniform float uTime, uSunI, uPxAng;
vec2 lonLatUV(vec3 d){
  float lon = atan(-d.z, d.x), lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
}
// Procedural relief that appears only where the 5400 px Blue Marble runs out of resolution:
// each octave fades in once its cell is several pixels wide (px = size of a pixel on the surface, Earth radii).
float terrainDetail(vec3 d, float px){
  float s = 0.0, a = 0.5, tot = 0.0, f = 60.0;
  for (int i = 0; i < 8; i++) {
    float w = smoothstep(1.5 * px, 6.0 * px, 1.0 / f);
    s += a * w * (vnoise(d * f) - 0.5);
    tot += a; a *= 0.6; f *= 2.2;
  }
  return s / tot;
}
// dirEF: Earth-fixed unit direction of the surface point. N: world normal. V: world dir to the camera.
vec3 earthSurface(vec3 dirEF, vec3 N, vec3 V, float cloudAmt, float dist){
  vec2 uv = lonLatUV(dirEF);
  vec3 day = texture2D(uDay, uv).rgb;
  vec3 night = texture2D(uNight, uv).rgb;
  float water = texture2D(uWater, uv).r;
  float tr = terrainDetail(dirEF, dist * uPxAng);
  day *= 1.0 + tr * 3.4 * (1.0 - water);
  night *= 1.0 + tr * 2.0;
  float cl = texture2D(uCloud, uv + vec2(uTime * 0.00004, 0.0)).r;
  float ndl = dot(N, uSunDir);
  float dayF = smoothstep(-0.10, 0.16, ndl);
  float lit = max(ndl, 0.0);
  vec3 col = day * (0.010 + 1.35 * pow(lit, 0.82)) * uSunI;
  col += night * night * (1.0 - dayF) * 1.7;
  float tw = smoothstep(-0.16, 0.0, ndl) * smoothstep(0.26, 0.0, ndl);
  col += vec3(0.55, 0.24, 0.10) * tw * 0.30;
  vec3 R = reflect(-uSunDir, N);
  float spec = pow(max(dot(R, V), 0.0), 600.0) * water * step(0.0, ndl);
  col += vec3(1.0, 0.92, 0.80) * spec * 5.0;
  float c = pow(clamp(cl, 0.0, 1.0), 1.25) * cloudAmt;
  col = mix(col, vec3(1.0, 1.0, 1.02) * (0.020 + 1.25 * pow(lit, 0.8)) * uSunI + vec3(0.02, 0.025, 0.04) * (1.0 - dayF), c * 0.86);
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  col += vec3(0.20, 0.45, 1.0) * fres * (0.10 + dayF * 0.95) * 1.1;
  return col;
}`;

const GLOBE_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vObj = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GLOBE_FRAG = /* glsl */ `
${EARTH_GLSL}
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  vec3 col = earthSurface(normalize(vObj), N, V, 1.0, length(cameraPosition - vW));
  gl_FragColor = vec4(col, 1.0);
}`;

const HALO_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec3 vC;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;      // centre of the globe, for the day/night term
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uSunDir; uniform float uAlpha;
varying vec3 vN; varying vec3 vW; varying vec3 vC;
void main(){
  // The glow of the air along this line of sight: strongest where the ray grazes the surface, fading to nothing at the
  // top of the shell (closest approach b between 1 and 1.032).  Not a rim term: that would peak on the shell's own edge.
  vec3 d = normalize(vW - cameraPosition);
  vec3 rel = cameraPosition - vC;
  float t = max(0.0, -dot(rel, d));
  vec3 cp = rel + d * t;                                  // closest point of the ray to the globe's centre
  float b = length(cp);
  float x = clamp((b - 1.0) / 0.032, 0.0, 1.0);
  float a = pow(1.0 - x, 2.6);
  float lit = 0.25 + 0.75 * smoothstep(-0.35, 0.5, dot(cp / max(b, 1e-4), uSunDir));
  vec3 c = vec3(0.25, 0.55, 1.0) * a * lit * uAlpha * 1.25;
  gl_FragColor = vec4(c, 1.0);
}`;

export class EarthGlobe {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'earth';
    this.u = earthUniforms();
    const geo = new THREE.SphereGeometry(1, 192, 96);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.u, ...logDepth(GLOBE_VERT, GLOBE_FRAG) }));
    this.mesh.renderOrder = -40; this.mesh.frustumCulled = false;
    this.haloU = { uSunDir: this.u.uSunDir, uAlpha: { value: 1.0 } };
    const hv = logDepth(HALO_VERT, HALO_FRAG);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1.032, 96, 48), new THREE.ShaderMaterial({
      uniforms: this.haloU, ...hv, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.halo.renderOrder = -39; this.halo.frustumCulled = false;
    this.group.add(this.mesh, this.halo);
  }
  setSun(dirWorld) { this.u.uSunDir.value.copy(dirWorld).normalize(); }
}

// ---------------------------------------------------------------- flat earth disc
const FLAT_VERT = /* glsl */ `
varying vec3 vL; varying vec3 vW;
void main(){
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FLAT_FRAG = /* glsl */ `
${EARTH_GLSL}
uniform float uDisc;                  // disc radius (world units)
uniform vec3 uSunPos; uniform float uLightR, uSunH;
uniform vec3 uObs; uniform float uRingA;
varying vec3 vL; varying vec3 vW;
void main(){
  float rho = length(vL.xz) / uDisc;
  float lat = 1.5707963 - rho * 3.14159265;
  float lon = atan(-vL.z, vL.x);
  vec3 dEF = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  // flat-earth daylight: the sun is a local lamp; ground is lit inside its light radius
  vec2 ds = vW.xz - uSunPos.xz;
  float dist = length(vec3(ds.x, uSunH, ds.y));
  float inner = length(ds);
  float dayMask = smoothstep(uLightR, uLightR * 0.78, inner);
  vec3 toSun = normalize(vec3(-ds.x, uSunH, -ds.y));
  float ndl = toSun.y;                                          // flat ground: normal is +Y
  vec3 V = normalize(cameraPosition - vW);
  // reuse the globe shading with a fake normal tilted toward the lamp so day/night read correctly
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 col;
  {
    vec2 uv = lonLatUV(dEF);
    vec3 day = texture2D(uDay, uv).rgb;
    vec3 night = texture2D(uNight, uv).rgb;
    float water = texture2D(uWater, uv).r;
    float cl = texture2D(uCloud, uv).r;
    float lit = max(ndl, 0.0) * dayMask;
    col = day * (0.010 + 1.35 * pow(lit, 0.82));
    col += night * night * (1.0 - dayMask) * 1.7;
    vec3 R = reflect(-toSun, N);
    col += vec3(1.0, 0.92, 0.80) * pow(max(dot(R, V), 0.0), 90.0) * water * dayMask * 2.0;
    float c = pow(clamp(cl, 0.0, 1.0), 1.25);
    col = mix(col, vec3(1.0) * (0.02 + 1.25 * pow(lit, 0.8)), c * 0.7);
  }
  // graticule: faint latitude circles every 15 deg and meridians every 30 deg (the "map" reading)
  float lg = abs(fract((90.0 - degrees(lat)) / 15.0 + 0.5) - 0.5);
  float mg = abs(fract(degrees(lon) / 30.0 + 0.5) - 0.5);
  float gw = fwidth(rho) * 90.0;
  float grat = (smoothstep(0.012 + gw * 0.0, 0.0, lg * 0.1 * 1.0) * 0.0);
  float ring = smoothstep(0.0025, 0.0, abs(fract(rho * 12.0 + 0.5) - 0.5) / 12.0);
  col += vec3(0.25, 0.55, 0.9) * ring * 0.10 * uRingA;
  float meridian = smoothstep(0.0012, 0.0, abs(fract(degrees(lon) / 30.0 + 0.5) - 0.5) * rho * 0.5) * step(0.02, rho);
  col += vec3(0.25, 0.55, 0.9) * meridian * 0.06 * uRingA;
  gl_FragColor = vec4(col, 1.0);
}`;

export class FlatEarth {
  constructor(radius = Math.PI) {
    this.radius = radius;
    this.group = new THREE.Group(); this.group.name = 'flatEarth';
    this.u = { ...earthUniforms(), uDisc: { value: radius }, uSunPos: { value: new THREE.Vector3(0, 0.75, 0) }, uLightR: { value: 1.9 }, uSunH: { value: 0.75 }, uObs: { value: new THREE.Vector3() }, uRingA: { value: 1 } };
    const geo = new THREE.CircleGeometry(radius, 256);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.u, ...logDepth(FLAT_VERT, FLAT_FRAG), extensions: { derivatives: true } }));
    this.mesh.renderOrder = -40; this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }
}
