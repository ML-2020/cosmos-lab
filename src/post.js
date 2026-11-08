// HDR post pipeline: scene -> half-float target -> bloom pyramid -> filmic composite.
// Dark gradients are dithered (triangular noise) so night skies never band.
import * as THREE from 'three';

const TRI_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// One NaN pixel in the HDR buffer is spread by the bloom pyramid into a black square (up to ~64 px wide) that flickers as the
// thing producing it moves.  Whatever a shader does on some GPU, no NaN may enter the pyramid: NaN -> 0, +/-Inf and runaway
// values are clamped.  (Tested by the bit pattern, which no compiler can optimise away like it can a `x != x` test.)
const CLEAN = /* glsl */ `
vec3 clean(vec3 c){
  bvec3 nan = greaterThan(floatBitsToUint(c) & uvec3(0x7fffffffu), uvec3(0x7f800000u));
  return mix(clamp(c, vec3(0.0), vec3(60000.0)), vec3(0.0), nan);
}`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uKaris;
varying vec2 vUv;
${CLEAN}
vec3 s(vec2 o){ return clean(texture2D(uTex, vUv + o * uTexel).rgb); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c){ return c / (1.0 + luma(c)); }
void main(){
  // 13-tap dual-filter downsample (Jimenez 2014)
  vec3 a = s(vec2(-2,2)), b = s(vec2(0,2)), c = s(vec2(2,2));
  vec3 d = s(vec2(-2,0)), e = s(vec2(0,0)), f = s(vec2(2,0));
  vec3 g = s(vec2(-2,-2)), h = s(vec2(0,-2)), i = s(vec2(2,-2));
  vec3 j = s(vec2(-1,1)), k = s(vec2(1,1)), l = s(vec2(-1,-1)), m = s(vec2(1,-1));
  vec3 r;
  if (uKaris > 0.5) {
    vec3 g0 = (karis(a)+karis(b)+karis(d)+karis(e)) * 0.25;
    vec3 g1 = (karis(b)+karis(c)+karis(e)+karis(f)) * 0.25;
    vec3 g2 = (karis(d)+karis(e)+karis(g)+karis(h)) * 0.25;
    vec3 g3 = (karis(e)+karis(f)+karis(h)+karis(i)) * 0.25;
    vec3 g4 = (karis(j)+karis(k)+karis(l)+karis(m)) * 0.25;
    r = g0*0.125 + g1*0.125 + g2*0.125 + g3*0.125 + g4*0.5;
    r = r / max(1.0 - luma(r), 0.05);
  } else {
    r = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  }
  gl_FragColor = vec4(r, 1.0);
}`;

const UP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLow, uHigh; uniform vec2 uTexel; uniform float uMix;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 r = texture2D(uLow, vUv + vec2(-1,-1)*t).rgb + texture2D(uLow, vUv + vec2(1,-1)*t).rgb
         + texture2D(uLow, vUv + vec2(-1, 1)*t).rgb + texture2D(uLow, vUv + vec2(1, 1)*t).rgb;
  r += 2.0 * (texture2D(uLow, vUv + vec2(0,-1)*t).rgb + texture2D(uLow, vUv + vec2(0,1)*t).rgb
            + texture2D(uLow, vUv + vec2(-1,0)*t).rgb + texture2D(uLow, vUv + vec2(1,0)*t).rgb);
  r += 4.0 * texture2D(uLow, vUv).rgb;
  r /= 16.0;
  gl_FragColor = vec4(texture2D(uHigh, vUv).rgb * uMix + r, 1.0);
}`;

const COMPOSE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uScene, uBloom, uAccum;
uniform float uExposure, uBloomAmt, uVignette, uGrain, uTime, uAspect, uUseAccum, uSat, uLift;
uniform vec3 uTint;
varying vec2 vUv;
${CLEAN}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 filmic(vec3 x){                                  // gentle shoulder, keeps stars white-hot but never clipped flat
  x = max(x, 0.0);
  vec3 a = 1.0 - exp(-x * 1.15);
  vec3 b = x / (x + 0.55);
  return mix(a, b, 0.35);
}
void main(){
  vec3 c = clean(texture2D(uScene, vUv).rgb);
  if (uUseAccum > 0.5) c = max(c, clean(texture2D(uAccum, vUv).rgb));
  vec3 bl = clean(texture2D(uBloom, vUv).rgb);
  c += bl * uBloomAmt;
  c *= uExposure * uTint;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = 1.0 - uVignette * smoothstep(0.25, 1.05, length(q) * 1.15);
  c *= vig;
  c = filmic(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat) + uLift;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float n = hash(gl_FragCoord.xy + uTime) + hash(gl_FragCoord.xy * 1.37 + uTime + 17.0) - 1.0;   // triangular dither
  c += n * (1.0 / 255.0) * (1.0 + uGrain * 2.5);
  gl_FragColor = vec4(c, 1.0);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: TRI_VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(g, null); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scn = new THREE.Scene(); this.scn.add(this.quad);

    this.matDown = fsMaterial(DOWN_FRAG, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.matUp = fsMaterial(UP_FRAG, { uLow: { value: null }, uHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
    this.u = {
      uScene: { value: null }, uBloom: { value: null }, uAccum: { value: null },
      uExposure: { value: 1 }, uBloomAmt: { value: 0.55 }, uVignette: { value: 0.35 }, uGrain: { value: 0.4 },
      uTime: { value: 0 }, uAspect: { value: 1 }, uUseAccum: { value: 0 }, uSat: { value: 1.05 }, uLift: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
    };
    this.matCompose = fsMaterial(COMPOSE_FRAG, this.u);
    this.levels = 6;
    this.settings = { exposure: 1, bloom: 0.55, vignette: 0.35, grain: 0.4 };
    this.rtScene = null; this.down = []; this.up = [];
  }

  #rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace, ...opts,
    });
  }

  // w,h in device pixels
  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene?.dispose(); this.down.forEach((t) => t.dispose()); this.up.forEach((t) => t.dispose());
    const caps = this.r.capabilities;
    this.rtScene = this.#rt(w, h, { depthBuffer: true, samples: caps.isWebGL2 ? 4 : 0 });
    this.down = []; this.up = [];
    for (let i = 0; i < this.levels; i++) {
      const lw = w / 2 ** (i + 1), lh = h / 2 ** (i + 1);
      this.down.push(this.#rt(lw, lh)); this.up.push(this.#rt(lw, lh));
    }
    this.u.uAspect.value = w / h;
  }

  #pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scn, this.cam);
  }

  // Renders scene+camera through bloom and composite onto the canvas (or `target`).
  render(scene, camera, time = 0, target = null) {
    const r = this.r, s = this.settings;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1); r.clear(true, true, true);
    r.render(scene, camera);

    // bloom pyramid
    let src = this.rtScene.texture, sw = this.w, sh = this.h;
    for (let i = 0; i < this.levels; i++) {
      this.matDown.uniforms.uTex.value = src;
      this.matDown.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.matDown.uniforms.uKaris.value = i === 0 ? 1 : 0;
      this.#pass(this.matDown, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    let low = this.down[this.levels - 1].texture;
    for (let i = this.levels - 2; i >= 0; i--) {
      this.matUp.uniforms.uLow.value = low;
      this.matUp.uniforms.uHigh.value = this.down[i].texture;
      this.matUp.uniforms.uTexel.value.set(1 / this.down[i + 1].width, 1 / this.down[i + 1].height);
      this.matUp.uniforms.uMix.value = 0.82;
      this.#pass(this.matUp, this.up[i]);
      low = this.up[i].texture;
    }

    this.u.uScene.value = this.rtScene.texture;
    this.u.uBloom.value = low;
    this.u.uExposure.value = s.exposure; this.u.uBloomAmt.value = s.bloom;
    this.u.uVignette.value = s.vignette; this.u.uGrain.value = s.grain;
    this.u.uTime.value = time % 97.0;
    this.#pass(this.matCompose, target);
    r.setRenderTarget(null);
  }

  dispose() {
    this.rtScene?.dispose(); this.down.forEach((t) => t.dispose()); this.up.forEach((t) => t.dispose());
  }
}
