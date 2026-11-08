// Compact land polygons (Natural Earth 50m via world-atlas) for the Earth textures.
// Output: src/generated/land.json = { polys: [ [ring, ring, ...], ... ] }
// ring = flat [lon, lat, lon, lat, ...] with 2 decimals.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const topo = JSON.parse(readFileSync(join(root, 'node_modules/world-atlas/land-50m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);
const geom = land.features[0].geometry;
const multi = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

const area = (ring) => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

const polys = [];
let kept = 0, dropped = 0, pts = 0;
for (const poly of multi) {
  if (area(poly[0]) < 0.35) { dropped++; continue; } // tiny islets
  const rings = poly.map((ring) => {
    const out = [];
    let lx = null, ly = null;
    for (const [x, y] of ring) {
      const rx = Math.round(x * 50) / 50, ry = Math.round(y * 50) / 50; // 0.02 deg
      if (rx === lx && ry === ly) continue;
      out.push(rx, ry);
      lx = rx; ly = ry;
    }
    pts += out.length / 2;
    return out;
  });
  polys.push(rings);
  kept++;
}
writeFileSync(join(root, 'src/generated/land.json'), JSON.stringify({ polys }));
console.log('polygons kept', kept, 'dropped', dropped, 'points', pts);
