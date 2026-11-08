// Beginner's guide to the night sky: the handful of things everyone has heard of, drawn and named.
// Stars are looked up by Hipparcos number in the catalogue, so the lines always land exactly on the stars.
import { STARS, NAMED } from './data.js';

const byHip = new Map(NAMED.map((n) => [n.h, n.i]));

// Dipper bowl and handle, W of Cassiopeia, hourglass of Orion, the Summer Triangle, the Southern Cross.
export const ASTERISMS = [
  { zh: '北斗七星', lines: [[54061, 53910, 58001, 59774, 54061], [59774, 62956, 65378, 67301]] },
  { zh: '仙后座（W）', lines: [[746, 3179, 4427, 6686, 8886]] },
  { zh: '猎户座', lines: [[27989, 26727], [25336, 25930], [25930, 26311, 26727], [26727, 27366], [25930, 24436], [27989, 25336]], at: [27989, 25336] },
  { zh: '夏季大三角', lines: [[91262, 97649, 102098, 91262]] },
  { zh: '南十字座', lines: [[60718, 61084], [62434, 59747]] },
];
// Finding Polaris: from 天璇 through 天枢, about five times their separation.
export const POINTER = { lines: [[53910, 54061, 11767]], label: '沿天璇→天枢延长，就是北极星', at: [54061, 11767] };

export const GUIDE_STARS = [
  [11767, '北极星', '永远在正北'], [54061, '天枢', '指极星'], [53910, '天璇', '指极星'],
  [32349, '天狼星', '最亮的恒星'], [91262, '织女星'], [97649, '牛郎星'], [102098, '天津四'],
  [27989, '参宿四', '红色'], [24436, '参宿七', '蓝白色'], [26311, '三星', '猎户腰带'], [80763, '心宿二', '天蝎之心'],
  [69673, '大角星'], [65474, '角宿一'], [24608, '五车二'], [37279, '南河三'], [30438, '老人星'],
];
export const GUIDE_INDEX = new Set(GUIDE_STARS.map(([h]) => byHip.get(h)).filter((i) => i !== undefined));

const radec = (hip) => { const i = byHip.get(hip); return i === undefined ? null : [STARS.ra[i], STARS.dec[i], i]; };
const mean = (hips) => {                               // direction of the mean of several stars -> [ra, dec]
  let x = 0, y = 0, z = 0, n = 0;
  for (const h of hips) { const p = radec(h); if (!p) continue; const a = p[0] * Math.PI / 180, d = p[1] * Math.PI / 180; x += Math.cos(d) * Math.cos(a); y += Math.cos(d) * Math.sin(a); z += Math.sin(d); n++; }
  if (!n) return null;
  return [((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360, Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI];
};
const polylines = (list) => [{ lines: list.flatMap((a) => a.lines.map((l) => l.map(radec).filter(Boolean).map((p) => [p[0], p[1]]))) }];

export function resolveGuide() {
  const anchors = [];
  for (const a of ASTERISMS) {
    const p = mean(a.at || a.lines.flat());
    if (p) anchors.push({ kind: 'guide', text: a.zh, ra: p[0], dec: p[1] });
  }
  const pp = mean(POINTER.at); if (pp) anchors.push({ kind: 'guide', text: POINTER.label, ra: pp[0], dec: pp[1] });
  for (const [h, text, sub] of GUIDE_STARS) { const p = radec(h); if (p) anchors.push({ kind: 'gstar', text: sub ? `${text} · ${sub}` : text, ra: p[0], dec: p[1], idx: p[2] }); }
  return { asterisms: polylines(ASTERISMS), pointer: polylines([POINTER]), anchors };
}
