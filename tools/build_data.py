"""Build every generated data module for the cosmology lab.

Inputs   data/*.json      d3-celestial catalogues (stars, names, constellations)
         assets/*         NASA Blue Marble / night-lights textures
Outputs  src/generated/stars.js      packed binary star catalogue (mag <= 8, 41k stars)
         src/generated/sky.json      names, western + Chinese constellations, deep-sky targets
         src/generated/mwgal.js      Milky Way baked from 118k real stars, galactic coordinates
         src/generated/tex_*.js      Earth textures as data URIs

Run:  python3 tools/build_data.py [stars|sky|mw|tex|all]
"""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'src', 'generated')
os.makedirs(OUT, exist_ok=True)


def load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def dump_json(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def write_js_uri(name, data, mime):
    b64 = base64.b64encode(data).decode('ascii')
    with open(os.path.join(OUT, name), 'w') as f:
        f.write('export default "data:%s;base64,%s";\n' % (mime, b64))
    print(' ', name, round(len(b64) / 1024), 'KB')


def ra_of(lon):
    return lon % 360.0


# Common Chinese names for the stars people actually look for (override the
# traditional asterism names, which are what d3-celestial stores).
ZH_COMMON = {
    11767: '北极星', 32349: '天狼星', 30438: '老人星', 69673: '大角星', 91262: '织女星',
    24608: '五车二', 24436: '参宿七', 27989: '参宿四', 37279: '南河三', 7588: '水委一',
    49669: '轩辕十四', 102098: '天津四', 97649: '河鼓二', 80763: '心宿二', 65474: '角宿一',
    21421: '毕宿五', 37826: '北河三', 113368: '北落师门', 71683: '南门二', 68702: '马腹一',
    60718: '十字架二', 62434: '十字架一', 59747: '十字架三', 54061: '天枢', 53910: '天璇',
    58001: '天玑', 59774: '天权', 62956: '玉衡', 65378: '开阳', 67301: '摇光',
    677: '壁宿二', 3419: '土司空', 25336: '参宿五', 26311: '参宿二', 26727: '参宿一',
    25930: '参宿三', 28360: '五车五', 31681: '北河二', 36850: '北河二', 17702: '昴宿六',
    11767 + 0: '北极星', 85927: '尾宿八', 86228: '尾宿五', 100751: '孔雀十一', 109268: '鹤一',
    9884: '娄宿三', 14135: '天囷一', 15863: '天船三', 68933: '库楼三', 61084: '十字架二',
}


# ================================================================= stars / names
def build_stars_and_sky():
    feats = load('stars.8.json')['features']
    feats.sort(key=lambda f: f['properties']['mag'])
    n = len(feats)
    ra = np.zeros(n, np.float32); dec = np.zeros(n, np.float32)
    mag = np.zeros(n, np.uint8); bv = np.zeros(n, np.uint8)
    hip = []
    for i, f in enumerate(feats):
        lon, lat = f['geometry']['coordinates']
        ra[i] = ra_of(lon); dec[i] = lat
        m = f['properties']['mag']
        mag[i] = int(round(np.clip((m + 2.0) * 20.0, 0, 255)))
        try:
            c = float(f['properties']['bv'])
        except (ValueError, TypeError):
            c = 0.6
        bv[i] = int(round(np.clip((c + 0.5) * 80.0, 0, 255)))
        hip.append(f['id'])
    blob = ra.tobytes() + dec.tobytes() + mag.tobytes() + bv.tobytes()
    b64 = base64.b64encode(blob).decode('ascii')
    with open(os.path.join(OUT, 'stars.js'), 'w') as fh:
        fh.write('export const N = %d;\nexport default "%s";\n' % (n, b64))
    print('stars', n, round(len(b64) / 1024), 'KB   faintest', feats[-1]['properties']['mag'])

    idx_of = {h: k for k, h in enumerate(hip)}
    magf = [f['properties']['mag'] for f in feats]
    west = load('starnames.json')
    cnn = load('starnames.cn.json')

    named = []
    for key, rec in west.items():
        h = int(key)
        if h not in idx_of:
            continue
        k = idx_of[h]
        proper = rec.get('name') or ''
        zh = ZH_COMMON.get(h) or (cnn.get(key, {}).get('name') or '')
        if magf[k] > 3.4 and h not in ZH_COMMON:
            continue
        if not proper and not zh:
            continue
        named.append({'i': k, 'h': h, 'en': proper, 'zh': zh,
                      'c': rec.get('c', ''), 'g': rec.get('desig', '')})
    # Chinese-only names for the brighter stars
    seen = {x['h'] for x in named}
    for key, rec in cnn.items():
        h = int(key)
        if h in seen or h not in idx_of:
            continue
        k = idx_of[h]
        if magf[k] <= 3.2:
            named.append({'i': k, 'h': h, 'en': '', 'zh': ZH_COMMON.get(h) or rec['name'], 'c': '', 'g': rec.get('desig', '')})
    named.sort(key=lambda x: x['i'])
    print('named stars', len(named))

    # ---- western constellations
    cl = load('constellations.lines.json')['features']
    cn = {f['id']: f for f in load('constellations.json')['features']}
    west_c = []
    for f in cl:
        cid = f['id']
        meta = cn.get(cid, {}).get('properties', {})
        cen = cn.get(cid, {}).get('geometry', {}).get('coordinates', [0, 0])
        lines = [[[round(ra_of(p[0]), 3), round(p[1], 3)] for p in ln] for ln in f['geometry']['coordinates']]
        west_c.append({'id': cid, 'en': meta.get('en') or meta.get('name') or cid, 'zh': meta.get('zh') or '',
                       'c': [round(ra_of(cen[0]), 2), round(cen[1], 2)], 'lines': lines})

    # ---- Chinese asterisms (三垣二十八宿 + 星官)
    cc = {f['id']: f for f in load('constellations.cn.json')['features']}
    cll = load('constellations.lines.cn.json')['features']
    cn_c = []
    for f in cll:
        meta = cc.get(f['id'], {}).get('properties', {})
        disp = meta.get('display') or [0, 0, 0]
        lines = [[[round(ra_of(p[0]), 3), round(p[1], 3)] for p in ln] for ln in f['geometry']['coordinates']]
        cn_c.append({'id': f['id'], 'zh': meta.get('name', ''), 'en': meta.get('en', ''), 'py': meta.get('pinyin', ''),
                     'rank': meta.get('rank', 3), 'c': [round(ra_of(disp[0]), 2), round(disp[1], 2)], 'lines': lines})

    # ---- deep-sky showpieces: [zh, en, ra, dec, mag, major', minor', pa, kind]
    dso = [
        ['银心 · 人马座A*', 'Galactic Centre', 266.4168, -29.0078, 0, 0, 0, 0, 'gc'],
        ['仙女座星系', 'Andromeda Galaxy M31', 10.6847, 41.2687, 3.4, 190, 60, 35, 'gal'],
        ['三角座星系', 'Triangulum Galaxy M33', 23.4621, 30.6599, 5.7, 70, 42, 23, 'gal'],
        ['大麦哲伦云', 'Large Magellanic Cloud', 80.894, -69.756, 0.9, 645, 550, 170, 'gal'],
        ['小麦哲伦云', 'Small Magellanic Cloud', 13.187, -72.828, 2.7, 320, 190, 45, 'gal'],
        ['猎户座大星云', 'Orion Nebula M42', 83.8221, -5.3911, 4.0, 85, 60, 0, 'neb'],
        ['昴星团', 'Pleiades M45', 56.75, 24.1167, 1.6, 110, 110, 0, 'oc'],
        ['鬼星团', 'Beehive M44', 130.1, 19.67, 3.7, 95, 95, 0, 'oc'],
        ['英仙座双星团', 'Double Cluster', 34.75, 57.13, 3.7, 60, 60, 0, 'oc'],
        ['半人马座ω', 'Omega Centauri', 201.697, -47.4795, 3.7, 36, 36, 0, 'gc'],
        ['杜鹃座47', '47 Tucanae', 6.0236, -72.0814, 4.1, 30, 30, 0, 'gc'],
        ['武仙座球状星团', 'Hercules Cluster M13', 250.4235, 36.4613, 5.8, 20, 20, 0, 'gc'],
        ['礁湖星云', 'Lagoon Nebula M8', 270.9, -24.4, 6.0, 90, 40, 0, 'neb'],
        ['三叶星云', 'Trifid Nebula M20', 270.6, -23.03, 6.3, 28, 28, 0, 'neb'],
        ['天鹅星云', 'Omega Nebula M17', 275.2, -16.17, 6.0, 46, 37, 0, 'neb'],
        ['哑铃星云', 'Dumbbell Nebula M27', 299.9, 22.72, 7.5, 8, 6, 0, 'pn'],
        ['北美洲星云', 'North America Nebula', 314.7, 44.3, 4.0, 120, 100, 0, 'neb'],
        ['船底座星云', 'Carina Nebula', 161.265, -59.867, 1.0, 120, 120, 0, 'neb'],
        ['玫瑰星云', 'Rosette Nebula', 98.0, 4.95, 9.0, 80, 80, 0, 'neb'],
    ]

    dump_json('sky.json', {
        'named': named,
        'west': west_c,
        'cn': cn_c,
        'dso': [{'zh': d[0], 'en': d[1], 'ra': d[2], 'dec': d[3], 'mag': d[4], 'maj': d[5], 'min': d[6], 'pa': d[7], 'k': d[8]} for d in dso],
    })
    print('constellations west', len(west_c), 'chinese', len(cn_c))


# ====================================================================== Milky Way
NGP_RA, NGP_DEC, L_NCP = 192.85948, 27.12825, 122.93192


def eq_to_gal(ra, dec):
    a = np.radians(ra - NGP_RA); d = np.radians(dec)
    dg = math.radians(NGP_DEC)
    sinb = np.sin(d) * math.sin(dg) + np.cos(d) * math.cos(dg) * np.cos(a)
    y = np.cos(d) * np.sin(a)
    x = np.sin(d) * math.cos(dg) - np.cos(d) * math.sin(dg) * np.cos(a)
    l = (L_NCP - np.degrees(np.arctan2(y, x))) % 360.0
    b = np.degrees(np.arcsin(np.clip(sinb, -1, 1)))
    return l, b


def gauss_blur(img, sigma_px, wrap_x=True):
    """Separable gaussian via FFT-free direct convolution (wraps in x, reflects in y)."""
    r = int(max(1, math.ceil(sigma_px * 3.5)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_px) ** 2); k /= k.sum()
    out = np.zeros_like(img, dtype=np.float32)
    pad = np.pad(img, ((0, 0), (r, r)), mode='wrap' if wrap_x else 'edge')
    for i, w in enumerate(k):
        out += w * pad[:, i:i + img.shape[1]]
    img2 = out
    out = np.zeros_like(img2)
    pad = np.pad(img2, ((r, r), (0, 0)), mode='reflect')
    for i, w in enumerate(k):
        out += w * pad[i:i + img.shape[0], :]
    return out


def gal_basis():
    """Rows of the EQJ -> galactic rotation (std equatorial axes)."""
    d2r = math.pi / 180
    gz = np.array([math.cos(NGP_DEC * d2r) * math.cos(NGP_RA * d2r), math.cos(NGP_DEC * d2r) * math.sin(NGP_RA * d2r), math.sin(NGP_DEC * d2r)])
    ra0, de0 = 266.40499 * d2r, -28.93617 * d2r
    gx = np.array([math.cos(de0) * math.cos(ra0), math.cos(de0) * math.sin(ra0), math.sin(de0)])
    gx = gx - gz * gx.dot(gz); gx /= np.linalg.norm(gx)
    gy = np.cross(gz, gx)
    return gx, gy, gz


def bilinear_wrap(img, x, y):
    """Sample img (H, W) at float pixel coords, wrapping in x, clamping in y."""
    H, W = img.shape
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = x - x0; fy = y - y0
    x0 %= W; x1 = (x0 + 1) % W
    ya = np.clip(y0, 0, H - 1); yb = np.clip(y0 + 1, 0, H - 1)
    return (img[ya, x0] * (1 - fx) * (1 - fy) + img[ya, x1] * fx * (1 - fy) +
            img[yb, x0] * (1 - fx) * fy + img[yb, x1] * fx * fy)


def noise_field(shape, sigmas, weights, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    for s, w in zip(sigmas, weights):
        n = gauss_blur(rng.standard_normal(shape).astype(np.float32), s)
        n /= n.std() + 1e-6
        out += w * n
    return out / sum(weights)


def gauss_blur_xy(img, sx, sy):
    r = int(max(1, math.ceil(sx * 3.5)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sx) ** 2); k /= k.sum()
    out = np.zeros_like(img, dtype=np.float32)
    pad = np.pad(img, ((0, 0), (r, r)), mode='wrap')
    for i, w in enumerate(k):
        out += w * pad[:, i:i + img.shape[1]]
    r = int(max(1, math.ceil(sy * 3.5)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sy) ** 2); k /= k.sum()
    o2 = np.zeros_like(out)
    pad = np.pad(out, ((r, r), (0, 0)), mode='reflect')
    for i, w in enumerate(k):
        o2 += w * pad[i:i + img.shape[0], :]
    return o2


def noise_xy(shape, sx, sy, seed):
    n = gauss_blur_xy(np.random.default_rng(seed).standard_normal(shape).astype(np.float32), sx, sy)
    return n / (n.std() + 1e-6)


def build_milkyway():
    """Milky Way map in galactic coordinates.

    Large scale brightness comes from the real isophote contours (d3-celestial
    Milky Way outline, rasterised earlier into data/milkyway_preview.png in
    RA/Dec).  The Great Rift is an explicit model: a thin dust lane along the
    plane, thick and dark toward the bulge, broken up by noise.
    """
    prior = np.array(Image.open(os.path.join(DATA, 'milkyway_preview.png')).convert('L'), np.float32) / 255.0
    PH, PW = prior.shape
    W, H = 2048, 1024
    ii = (np.arange(W) + 0.5) / W; jj = (np.arange(H) + 0.5) / H
    l = (ii - 0.5) * 360.0                      # u=0.5 -> l=0 (galactic centre mid-texture)
    b = jj * 180.0 - 90.0
    L, Bm = np.meshgrid(np.radians(l), np.radians(b))
    gx, gy, gz = gal_basis()
    X = np.cos(Bm) * np.cos(L); Y = np.cos(Bm) * np.sin(L); Z = np.sin(Bm)
    ex = X * gx[0] + Y * gy[0] + Z * gz[0]
    ey = X * gx[1] + Y * gy[1] + Z * gz[1]
    ez = X * gx[2] + Y * gy[2] + Z * gz[2]
    ra = np.degrees(np.arctan2(ey, ex)) % 360.0
    dec = np.degrees(np.arcsin(np.clip(ez, -1, 1)))
    P = bilinear_wrap(prior, ra / 360.0 * PW - 0.5, (90.0 - dec) / 180.0 * PH - 0.5)
    Pf = gauss_blur(P.astype(np.float32), 11.0)              # remove the isophote steps
    Pc = gauss_blur(P.astype(np.float32), 26.0)

    lw = (l + 0.0)[None, :].repeat(H, axis=0)
    bw = b[:, None].repeat(W, axis=1)
    # analytic band: exponential in |b|, wider and brighter toward the bulge
    bulge = np.exp(-(lw / 38.0) ** 2)
    scale_h = 4.2 + 5.5 * bulge
    band = np.exp(-np.abs(bw) / scale_h)
    n_big = noise_field((H, W), [10, 24, 60], [1.0, 1.0, 0.8], 3)
    n_mid = 0.6 * noise_xy((H, W), 9.0, 2.4, 5) + 0.4 * noise_xy((H, W), 4.0, 1.6, 6)   # streaks along the plane

    # brightness: real contours dominate, band model supplies the smooth falloff and bulge
    base = np.clip(Pf, 0, 1) ** 0.9
    lum = base * (0.62 + 0.30 * np.tanh(n_big * 0.9) + 0.13 * n_mid) + 0.20 * band * (0.35 + 0.65 * bulge) * (0.7 + 0.3 * n_big)
    lum *= np.clip(1.25 - np.abs(bw) / 55.0, 0, 1)
    lum = np.clip(lum, 0, None)
    lum /= np.percentile(lum, 99.7)

    # Great Rift: dark lane meandering about b~0.. +2, strongest l in [-45, 80]
    lane_c = 1.2 * np.sin(np.radians(lw) * 1.6 + 0.6) + 0.5 * n_big
    env = np.clip(np.exp(-((lw - 18.0) / 62.0) ** 2) * 1.15 + 0.22, 0, 1)
    w_lane = 1.1 + 2.4 * bulge
    lane = np.exp(-0.5 * ((bw - lane_c) / w_lane) ** 2)
    patch = np.clip(0.62 + 0.55 * n_mid + 0.40 * n_big, 0, 1) ** 1.2
    dust_big = np.clip(lane * env * patch * 1.05, 0, 0.92)
    # real dark patches: where the fine contour map dips below its surroundings inside the band
    dip = np.clip((Pc - Pf) / 0.28, 0, 1) * np.clip(Pc * 2.2, 0, 1)
    dust = np.clip(dust_big + 0.55 * dip, 0, 0.95)
    dust = gauss_blur_xy(dust.astype(np.float32), 2.6, 1.3)

    warm = np.clip(0.95 * bulge + 0.30 + 0.22 * n_big - 0.1 * np.abs(bw) / 20.0, 0, 1)
    warm = np.clip(warm * (0.8 + 0.4 * dust), 0, 1)

    rgb = np.stack([np.clip(lum, 0, 1), np.clip(dust, 0, 1), warm], axis=-1)
    img = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), 'RGB').transpose(Image.FLIP_TOP_BOTTOM)   # row 0 = b +90 (shader v = b/pi + 0.5, flipY)
    img.save(os.path.join(DATA, 'mw_gal_preview.png'))
    buf = io.BytesIO(); img.save(buf, format='PNG', optimize=True)
    write_js_uri('mwgal.js', buf.getvalue(), 'image/png')


# ====================================================================== textures
def build_textures():
    def jpeg(path, size=None, q=82, mode='RGB'):
        im = Image.open(path).convert(mode)
        if size:
            im = im.resize(size, Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, format='JPEG', quality=q, optimize=True, progressive=True)
        return buf.getvalue()

    write_js_uri('tex_day.js', jpeg(os.path.join(ASSETS, 'earth-blue-marble.jpg'), (4096, 2048), 80), 'image/jpeg')
    write_js_uri('tex_night.js', jpeg(os.path.join(ASSETS, 'earth-night.jpg'), (4096, 2048), 78), 'image/jpeg')
    # ocean mask (white = water) at half resolution, single channel
    write_js_uri('tex_water.js', jpeg(os.path.join(ASSETS, 'earth-water.png'), (2048, 1024), 80, 'L'), 'image/jpeg')
    # clouds: luminance only
    cl = os.path.join(ASSETS, 'clouds.png')
    if os.path.exists(cl):
        im = Image.open(cl)
        im = im.convert('RGBA')
        a = np.array(im)
        lum = np.maximum(a[..., :3].max(axis=-1) * (a[..., 3] / 255.0), a[..., 3] * 0.0)
        lum = np.clip(lum, 0, 255).astype(np.uint8)
        g = Image.fromarray(lum, 'L').resize((2048, 1024), Image.LANCZOS)
        buf = io.BytesIO(); g.save(buf, format='JPEG', quality=80, optimize=True)
        write_js_uri('tex_clouds.js', buf.getvalue(), 'image/jpeg')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('stars', 'sky', 'all'):
        build_stars_and_sky()
    if what in ('mw', 'all'):
        build_milkyway()
    if what in ('tex', 'all'):
        build_textures()
