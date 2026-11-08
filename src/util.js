import * as THREE from 'three';

// B-V colour index -> temperature (Ballesteros 2012) -> RGB (Tanner Helland fit), slightly saturated.
export function bvToRGB(bv, out = [0, 0, 0]) {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const t = T / 100;
  let r, g, bl;
  if (t <= 66) r = 255; else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661; else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) bl = 255; else if (t <= 19) bl = 0; else bl = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  const rr = c(r), gg = c(g), bb = c(bl), m = (rr + gg + bb) / 3;
  out[0] = Math.max(0, Math.min(1, m + (rr - m) * 1.3));
  out[1] = Math.max(0, Math.min(1, m + (gg - m) * 1.3));
  out[2] = Math.max(0, Math.min(1, m + (bb - m) * 1.3));
  return out;
}

// Soft radial glow texture (suns, planets, Moon halo).
export function glowTexture(size = 256, stops = [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Make a custom ShaderMaterial agree with built-in materials under logarithmicDepthBuffer.
export function logDepth(vertex, fragment) {
  const v = '#include <common>\n#include <logdepthbuf_pars_vertex>\n' +
    vertex.replace(/void\s+main\s*\(\s*\)\s*\{([\s\S]*)\}\s*$/, (_, body) => `void main() {${body}\n#include <logdepthbuf_vertex>\n}`);
  const f = '#include <common>\n#include <logdepthbuf_pars_fragment>\n' +
    fragment.replace(/void\s+main\s*\(\s*\)\s*\{/, 'void main() {\n#include <logdepthbuf_fragment>\n');
  return { vertexShader: v, fragmentShader: f };
}

export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
`;

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// log-space interpolation between positive a and b
export const lerpLog = (a, b, t) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
