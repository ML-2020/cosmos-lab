// The sky you stand under: a camera-centred dome whose colour follows the real Sun altitude
// (night, astronomical/nautical/civil twilight, golden hour, day), Moon glow, light pollution
// and airglow.  The same radiance function feeds the ground haze so the horizon never seams.
//
// Everything is linear HDR; the App drives exposure from the Sun altitude (see app.js).
import * as THREE from 'three';

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uUp, uLPCol;
uniform float uMoonI, uAtmo, uLP, uDayGain;
vec3 ladder(float a, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5, vec3 c6, vec3 c7){
  // sun altitude keys: -18, -12, -6, -2, 0, 3, 10, 30 (deg)
  vec3 c = c0;
  c = mix(c, c1, smoothstep(-18.0, -12.0, a));
  c = mix(c, c2, smoothstep(-12.0, -6.0, a));
  c = mix(c, c3, smoothstep(-6.0, -2.0, a));
  c = mix(c, c4, smoothstep(-2.0, 0.0, a));
  c = mix(c, c5, smoothstep(0.0, 3.0, a));
  c = mix(c, c6, smoothstep(3.0, 10.0, a));
  c = mix(c, c7, smoothstep(10.0, 30.0, a));
  return c;
}
vec3 skyRadiance(vec3 d){
  float el = clamp(dot(d, uUp), -1.0, 1.0);
  float sa = clamp(dot(uSunDir, uUp), -1.0, 1.0);
  float sunAlt = degrees(asin(sa));
  float night = smoothstep(-6.0, -15.0, sunAlt);            // 1 = deep night
  float cosS = dot(d, uSunDir);

  vec3 zen = ladder(sunAlt, vec3(0.00055, 0.0010, 0.0027), vec3(0.0036, 0.0075, 0.021), vec3(0.020, 0.040, 0.118),
                    vec3(0.058, 0.105, 0.290), vec3(0.120, 0.200, 0.470), vec3(0.165, 0.285, 0.660),
                    vec3(0.185, 0.350, 0.840), vec3(0.200, 0.400, 0.950)) ;
  vec3 hor = ladder(sunAlt, vec3(0.0017, 0.0027, 0.0057), vec3(0.011, 0.017, 0.038), vec3(0.060, 0.062, 0.115),
                    vec3(0.200, 0.160, 0.230), vec3(0.480, 0.360, 0.390), vec3(0.720, 0.620, 0.600),
                    vec3(0.640, 0.760, 0.930), vec3(0.600, 0.780, 1.000));
  float day = smoothstep(-4.0, 6.0, sunAlt);
  zen *= mix(1.0, uDayGain, day); hor *= mix(1.0, uDayGain, day);

  float e = max(el, 0.0);
  vec3 col = mix(hor, zen, pow(e, 0.42));

  // twilight arch: warm glow on the Sun's side of the horizon, anti-twilight (Belt of Venus) opposite
  vec3 hd = d - uUp * el, hs = uSunDir - uUp * sa;
  float hl = length(hd) * length(hs);
  float align = hl > 1e-4 ? dot(hd, hs) / hl : 0.0;
  float twi = smoothstep(-11.0, -3.0, sunAlt) * smoothstep(9.0, 1.0, sunAlt);
  float low = exp(-e * 5.5);
  col += vec3(1.00, 0.42, 0.17) * twi * low * (0.05 + 0.50 * pow(max(align * 0.5 + 0.5, 0.0), 3.0)) * mix(0.20, 1.2, smoothstep(-8.0, 0.0, sunAlt));
  col += vec3(0.55, 0.30, 0.38) * twi * exp(-pow((el - 0.10) / 0.10, 2.0)) * (0.5 - 0.5 * align) * 0.10;

  // Sun: Mie forward scatter + aureole
  float sunUp = smoothstep(-5.0, 2.0, sunAlt);
  col += vec3(1.0, 0.82, 0.58) * (0.55 * pow(max(cosS, 0.0), 220.0) * 6.0 + 0.30 * pow(max(cosS, 0.0), 12.0) + 0.06 * pow(max(cosS, 0.0), 3.0)) * sunUp * uDayGain * 0.35;

  // Moon: glow + blue scattered light that lifts the whole night sky
  float cosM = dot(d, uMoonDir);
  float moonAlt = dot(uMoonDir, uUp);
  float mUp = smoothstep(-0.10, 0.12, moonAlt);
  vec3 moonC = vec3(0.70, 0.80, 1.00);
  col += moonC * uMoonI * mUp * (0.32 * pow(max(cosM, 0.0), 90.0) + 0.06 * pow(max(cosM, 0.0), 10.0) + 0.012 * pow(max(cosM, 0.0), 2.0)) * night;
  col += vec3(0.0095, 0.0145, 0.031) * uMoonI * mUp * (0.35 + 0.65 * (1.0 - e * 0.5)) * night;

  // light pollution domes and airglow
  col += uLPCol * uLP * (0.032 * low + 0.008 * exp(-e * 1.5)) * night;
  col += vec3(0.04, 0.16, 0.07) * 0.012 * exp(-pow((el - 0.17) / 0.13, 2.0)) * night * (1.0 - 0.8 * uLP);
  return col * uAtmo;
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  mat4 v = viewMatrix; v[3] = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 p = projectionMatrix * v * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const DOME_FRAG = /* glsl */ `
${SKY_GLSL}
varying vec3 vDir;
void main(){
  vec3 c = skyRadiance(normalize(vDir));
  gl_FragColor = vec4(c, 1.0);
}`;

export function skyUniforms() {
  return {
    uSunDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) }, uLPCol: { value: new THREE.Vector3(1.0, 0.56, 0.26) },
    uMoonI: { value: 0 }, uAtmo: { value: 1 }, uLP: { value: 0.15 }, uDayGain: { value: 3.2 },
  };
}

export class SkyDome {
  constructor(u = skyUniforms()) {
    this.u = u;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false }),
    );
    this.mesh.renderOrder = -100; this.mesh.frustumCulled = false;
  }
}
