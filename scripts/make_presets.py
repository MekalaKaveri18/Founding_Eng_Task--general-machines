"""Generate the three preset plots from real OSM road centrelines.

Each plot is drawn in a local frame (u = along the road, v = away from it), starting at the
road boundary (centreline offset by half the right-of-way), then converted to WGS84.
Edge i runs from vertex i to vertex i+1. `frontage` lists the edges that face a road.

Usage: python scripts/make_presets.py public/data/roads.geojson src/presets.json
"""
import json
import math
import sys

LAT0 = 13.73
MX = 111320 * math.cos(math.radians(LAT0))  # metres per degree of longitude
MY = 110574                                  # metres per degree of latitude


def to_m(p, o):
    return ((p[0] - o[0]) * MX, (p[1] - o[1]) * MY)


def to_ll(q, o):
    return [round(o[0] + q[0] / MX, 7), round(o[1] + q[1] / MY, 7)]


def unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    return dx / n, dy / n


def frame_on_road(line, origin, along_m, side):
    """Point `along_m` metres along `line` (lon/lat list) and its local axes.
    side=+1 puts the plot to the left of the line direction, -1 to the right."""
    pts = [to_m(p, origin) for p in line]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if acc + seg >= along_m:
            t = (along_m - acc) / seg
            p = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            u = unit(a, b)
            v = (-u[1] * side, u[0] * side)
            return p, u, v
        acc += seg
    raise ValueError("along_m beyond line length")


def place(p, u, v, offset, local):
    """local (s, t) -> metres: start at p + v*offset (road boundary), s along u, t along v."""
    return [(p[0] + u[0] * s + v[0] * (offset + t), p[1] + u[1] * s + v[1] * (offset + t)) for s, t in local]


def line_of(roads, way_id):
    return next(f for f in roads if f["properties"]["id"] == way_id)["geometry"]["coordinates"]


def intersect(p1, d1, p2, d2):
    den = d1[0] * d2[1] - d1[1] * d2[0]
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return (p1[0] + t * d1[0], p1[1] + t * d1[1])


def main():
    roads = json.load(open(sys.argv[1], encoding="utf-8"))["features"]
    origin = (100.565, 13.73)
    presets = []

    # 1. Sukhumvit Soi 22: irregular pentagon on the east side of the soi.
    soi22 = list(reversed(line_of(roads, 156261422)))  # now runs south from Sukhumvit
    row22 = 12.0
    p, u, v = frame_on_road(soi22, origin, 340, side=+1)  # left of a southbound line = east
    poly = place(p, u, v, row22 / 2, [(0, 0), (52, 0), (55, 38), (28, 62), (-4, 50)])
    presets.append({"id": "soi22", "name": "Sukhumvit Soi 22", "zone": "Y10",
                    "note": "Mid-soi lot, east side. Zone ย.10 per agent listings for Soi 22 (not an official certificate).",
                    "roads": [{"edge": 0, "row": row22, "name": "Soi Sukhumvit 22"}],
                    "coords": [to_ll(q, origin) for q in poly]})

    # 2. Narrow 6 m soi: small lot on the north side of Soi Sai Nam Thip 1 (runs west from Soi 22).
    snt = line_of(roads, 156261363)  # east -> west
    row6 = 6.0
    p, u, v = frame_on_road(snt, origin, 45, side=-1)  # right of a westbound line = north
    poly = place(p, u, v, row6 / 2, [(0, 0), (24, 0), (24, 31), (0, 34)])
    presets.append({"id": "narrow", "name": "Narrow 6 m soi lot", "zone": "Y10",
                    "note": "Soi Sai Nam Thip 1, off Soi 22. Shows how a narrow soi limits height and blocks high-rise.",
                    "roads": [{"edge": 0, "row": row6, "name": "Soi Sai Nam Thip 1"}],
                    "coords": [to_ll(q, origin) for q in poly]})

    # 3. Corner of Sukhumvit Road (30 m ROW, assumed) and Soi 22 (12 m), south-east corner.
    # Sukhumvit is mapped as two carriageways about 11 m apart; take the midline as the centreline.
    wb = to_m((100.565173, 13.733583), origin)   # westbound carriageway node at the soi junction
    eb = to_m((100.565233, 13.733668), origin)   # eastbound carriageway node opposite it
    c_suk = ((wb[0] + eb[0]) / 2, (wb[1] + eb[1]) / 2)
    d_suk = unit(to_m((100.565983, 13.733015), origin), to_m((100.565173, 13.733583), origin))
    d_suk = (-d_suk[0], -d_suk[1])               # point it south-east
    n_suk = (d_suk[1], -d_suk[0])                # right-hand normal = south-west side
    rowS = 30.0
    s_dir = unit(to_m(soi22[0], origin), to_m(soi22[3], origin))  # soi 22 heading south
    n_soi = (-s_dir[1], s_dir[0])                # left normal of southbound = east
    if n_soi[0] < 0:
        n_soi = (-n_soi[0], -n_soi[1])
    if n_suk[1] > 0:
        n_suk = (-n_suk[0], -n_suk[1])
    a = (c_suk[0] + n_suk[0] * rowS / 2, c_suk[1] + n_suk[1] * rowS / 2)
    b = (to_m(soi22[0], origin)[0] + n_soi[0] * row22 / 2, to_m(soi22[0], origin)[1] + n_soi[1] * row22 / 2)
    corner = intersect(a, d_suk, b, s_dir)
    p0 = corner
    p1 = (corner[0] + d_suk[0] * 62, corner[1] + d_suk[1] * 62)          # along Sukhumvit
    p4 = (corner[0] + s_dir[0] * 70, corner[1] + s_dir[1] * 70)          # along Soi 22
    p2 = (p1[0] + s_dir[0] * 46, p1[1] + s_dir[1] * 46)                  # back from the Sukhumvit end
    p3 = ((p2[0] + p4[0]) / 2 + s_dir[0] * 8, (p2[1] + p4[1]) / 2 + s_dir[1] * 8)  # far side, between the two back corners
    poly = [p0, p1, p2, p3, p4]
    presets.append({"id": "corner", "name": "Sukhumvit Rd corner lot", "zone": "Y10",
                    "note": "Corner of Sukhumvit Road (ROW 30 m, assumed) and Soi 22. Two frontages; the wider road governs height (MR 55 art. 46).",
                    "roads": [{"edge": 0, "row": rowS, "name": "Sukhumvit Road"},
                              {"edge": 4, "row": row22, "name": "Soi Sukhumvit 22"}],
                    "coords": [to_ll(q, origin) for q in poly]})

    for pr in presets:
        m = [to_m(c, origin) for c in pr["coords"]]
        area = abs(sum(m[i][0] * m[(i + 1) % len(m)][1] - m[(i + 1) % len(m)][0] * m[i][1] for i in range(len(m)))) / 2
        pr["area_m2_approx"] = round(area)
        print(pr["id"], "area m2", round(area), pr["coords"][0])
    json.dump(presets, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
