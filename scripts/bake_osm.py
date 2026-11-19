"""Bake static site-context data for the tool from an OpenStreetMap extract.

Why pre-bake: the public Overpass API is not reliable enough to depend on at page load,
and OSM has almost no road-width tags, so roads also get an estimated right-of-way here.

Usage:
    python scripts/bake_osm.py <Bangkok.osm.pbf> public/data

Input:  BBBike Bangkok extract (https://download.bbbike.org/osm/bbbike/Bangkok/Bangkok.osm.pbf)
Output: buildings.geojson, roads.geojson, stations.geojson (WGS84)
Needs:  pip install osmium
"""
import json
import re
import sys

import osmium

# Sukhumvit corridor: Nana (Soi 3) to Ekkamai (Soi 63), Rama IV to Phetchaburi
W, S, E, N = 100.545, 13.712, 100.590, 13.752

FLOOR_M = 3.2  # assumed floor-to-floor height for buildings tagged only with levels
# Fallback heights for buildings with no height or level tags (assumption, shown in the UI)
DEFAULT_H = {"house": 7.0, "detached": 7.0, "terrace": 10.0, "residential": 10.0,
             "commercial": 10.0, "retail": 10.0, "apartments": 12.8, "garage": 3.0,
             "roof": 4.0, "shed": 3.0, "temple": 12.0}
DEFAULT_OTHER = 7.0

# Estimated right-of-way (m) by OSM highway class: used only as the default the user overrides
ROW_BY_CLASS = {"motorway": 40, "trunk": 40, "primary": 30, "secondary": 20, "tertiary": 16,
                "unclassified": 10, "residential": 8, "living_street": 6, "service": 6}
KEEP_HIGHWAY = set(ROW_BY_CLASS) | {"primary_link", "secondary_link", "tertiary_link"}


def inside(lon, lat):
    return W <= lon <= E and S <= lat <= N


def num(v):
    if v is None:
        return None
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)", v)
    return float(m.group(1)) if m else None


def rnd(c):
    return [round(c[0], 6), round(c[1], 6)]


class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings, self.roads, self.stations = [], [], {}

    def node(self, n):
        t = n.tags
        if not inside(n.location.lon, n.location.lat):
            return
        if t.get("railway") == "station" or (t.get("public_transport") == "station" and t.get("train") == "yes"):
            name = t.get("name:en") or t.get("name") or "Station"
            self.stations[name] = {"type": "Feature",
                                   "geometry": {"type": "Point", "coordinates": rnd((n.location.lon, n.location.lat))},
                                   "properties": {"name": name, "name_th": t.get("name", ""),
                                                  "network": t.get("network", "")}}

    def way(self, w):
        t = w.tags
        is_b = "building" in t
        hw = t.get("highway")
        if not is_b and hw not in KEEP_HIGHWAY:
            return
        try:
            coords = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2 or not any(inside(*c) for c in coords):
            return
        if is_b:
            if coords[0] != coords[-1] or len(coords) < 4:
                return
            h, src = num(t.get("height")), "height"
            if h is None:
                lv = num(t.get("building:levels"))
                if lv is not None:
                    h, src = lv * FLOOR_M, "levels"
            if h is None:
                h, src = DEFAULT_H.get(t.get("building"), DEFAULT_OTHER), "default"
            self.buildings.append({"type": "Feature",
                                   "geometry": {"type": "Polygon", "coordinates": [[rnd(c) for c in coords]]},
                                   "properties": {"id": w.id, "h": round(h, 1), "src": src,
                                                  "name": t.get("name:en") or t.get("name") or ""}})
        else:
            cls = hw.replace("_link", "")
            lanes = num(t.get("lanes"))
            width = num(t.get("width"))
            self.roads.append({"type": "Feature",
                               "geometry": {"type": "LineString", "coordinates": [rnd(c) for c in coords]},
                               "properties": {"id": w.id, "cls": cls,
                                              "name": t.get("name:en") or t.get("name") or "",
                                              "name_th": t.get("name", ""),
                                              "lanes": lanes, "width_tag": width,
                                              "row_est": ROW_BY_CLASS.get(cls, 8)}})


def dump(path, feats):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))


def main():
    pbf, out = sys.argv[1], sys.argv[2]
    h = Handler()
    h.apply_file(pbf, locations=True)
    dump(f"{out}/buildings.geojson", h.buildings)
    dump(f"{out}/roads.geojson", h.roads)
    dump(f"{out}/stations.geojson", list(h.stations.values()))
    src = {}
    for b in h.buildings:
        src[b["properties"]["src"]] = src.get(b["properties"]["src"], 0) + 1
    print("buildings", len(h.buildings), src)
    print("roads", len(h.roads))
    print("stations", sorted(h.stations))


if __name__ == "__main__":
    main()
