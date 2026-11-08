// Decoded catalogues: packed stars (mag <= 8), names, constellations, deep-sky targets.
import starsB64, { N as STAR_COUNT } from './generated/stars.js';
import SKY from './generated/sky.json';

function decode(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

const u8 = decode(starsB64);
const N = STAR_COUNT;
export const STARS = {
  n: N,
  ra: new Float32Array(u8.buffer, 0, N),                 // degrees, J2000
  dec: new Float32Array(u8.buffer, 4 * N, N),
  magQ: new Uint8Array(u8.buffer, 8 * N, N),             // (mag + 2) * 20
  bvQ: new Uint8Array(u8.buffer, 9 * N, N),              // (bv + 0.5) * 80
  mag(i) { return this.magQ[i] / 20 - 2; },
  bv(i) { return this.bvQ[i] / 80 - 0.5; },
};

export const NAMED = SKY.named;          // [{i, h, en, zh, c, g}]
export const WEST = SKY.west;            // 88 IAU constellations: {id, en, zh, c:[ra,dec], lines}
export const CN = SKY.cn;                // 312 Chinese asterisms: {id, zh, en, py, rank, c, lines}
export const DSO = SKY.dso;              // showpiece deep-sky objects

// Well-known stars by Hipparcos number -> catalogue index (for markers and readouts).
const hipIndex = new Map(NAMED.map((n) => [n.h, n.i]));
export const starIndexByHip = (h) => hipIndex.get(h);
export const POLARIS_INDEX = hipIndex.get(11767);
export const SIRIUS_INDEX = hipIndex.get(32349);
