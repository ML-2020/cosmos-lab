import json, sys

m = json.load(open(sys.argv[1]))
for ft in m['features']:
    rings = ft['geometry']['coordinates']
    info = []
    for ri, ring in enumerate(rings):
        lon = [p[0] for p in ring]
        # unwrap longitudes
        un = [lon[0]]
        for x in lon[1:]:
            d = x - (un[-1] % 360 if False else un[-1])
            # bring x as close as possible to previous unwrapped
            while x - un[-1] > 180:
                x -= 360
            while x - un[-1] < -180:
                x += 360
            un.append(x)
        span = max(un) - min(un)
        net = un[-1] - un[0]
        closed = ring[0] == ring[-1]
        info.append((ri, len(ring), round(span, 1), round(net, 1), closed))
    winders = [i for i in info if abs(i[3]) > 180]
    print(ft['id'], 'rings', len(rings), 'winding rings', winders[:6], 'max span', max(i[2] for i in info))
