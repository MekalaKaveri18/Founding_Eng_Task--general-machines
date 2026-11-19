import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import type { Frame, XY } from "../geo/local";
import type { Envelope, RuleId } from "../engine/envelope";
import { regionToPolygons } from "../engine/geom";

export const RULE_COLORS: Record<RuleId, string> = {
  "road-setback": "#2563eb",
  boundary: "#db2777",
  "height-plane": "#ea580c",
  "far-cap": "#7c3aed",
};
export const RULE_LABELS: Record<RuleId, string> = {
  "road-setback": "Road setback",
  boundary: "Boundary distance",
  "height-plane": "2:1 height plane",
  "far-cap": "FAR cap",
};
export const MODE_COLORS = { low: "#14917f", high: "#4458e0" };
const BEYOND_COLOR = "#9aa5d6";

const EPS = 0.01; // m. Lifts each block's base a hair above the one below so stacked faces are never coplanar.

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function addEnvelopeLayers(map: MLMap) {
  for (const id of ["env", "ghost", "foot", "edge-hl"]) map.addSource(id, { type: "geojson", data: EMPTY });

  map.addLayer({
    id: "foot-fill", type: "fill", source: "foot",
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "foot-line", type: "line", source: "foot",
    paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "env-solid", type: "fill-extrusion", source: "env", filter: ["==", ["get", "kind"], "solid"],
    paint: {
      "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-opacity": 0.82, "fill-extrusion-vertical-gradient": true,
    },
  });
  map.addLayer({
    id: "env-beyond", type: "fill-extrusion", source: "env", filter: ["==", ["get", "kind"], "beyond"],
    paint: {
      "fill-extrusion-color": BEYOND_COLOR, "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-opacity": 0.32,
    },
  });
  map.addLayer({
    id: "ghost-3d", type: "fill-extrusion", source: "ghost",
    paint: {
      "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-opacity": 0.5,
    },
  });
  map.addLayer({
    id: "edge-hl", type: "line", source: "edge-hl",
    paint: { "line-color": "#f59e0b", "line-width": 7, "line-opacity": 0.9 }, layout: { "line-cap": "round" },
  });
}

function ringLL(frame: Frame, ring: XY[]): number[][] {
  const pts = ring.map((p) => frame.toLngLat(p) as number[]);
  pts.push(pts[0]);
  return pts;
}

function polysLL(frame: Frame, polys: XY[][][]): number[][][][] {
  return polys.map((poly) => poly.map((ring) => ringLL(frame, ring)));
}

function feature(frame: Frame, polys: XY[][][], props: Record<string, unknown>): GeoJSON.Feature {
  return { type: "Feature", properties: props, geometry: { type: "MultiPolygon", coordinates: polysLL(frame, polys) } };
}

export interface EnvelopeBlock {
  floors: [number, number];
  base: number;
  top: number;
  beyond: boolean;
}

/** Merge consecutive floors with identical plates into one block, split at the FAR cap. */
export function groupSlices(env: Envelope): { block: EnvelopeBlock; polys: XY[][][] }[] {
  const out: { block: EnvelopeBlock; polys: XY[][][]; area: number }[] = [];
  for (const s of env.slices) {
    const beyond = s.floor > env.capFloor;
    const last = out[out.length - 1];
    if (last && last.block.beyond === beyond && Math.abs(last.area - s.area) < 1e-4) {
      last.block.top = s.zTop;
      last.block.floors[1] = s.floor;
    } else {
      out.push({
        block: { floors: [s.floor, s.floor], base: s.zBase + (out.length ? EPS : 0), top: s.zTop, beyond },
        polys: regionToPolygons(s.region),
        area: s.area,
      });
    }
  }
  return out;
}

export function showEnvelope(map: MLMap, frame: Frame, env: Envelope | null, color: string) {
  const envSrc = map.getSource("env") as GeoJSONSource;
  const footSrc = map.getSource("foot") as GeoJSONSource;
  if (!env || !env.allowed) {
    envSrc.setData(EMPTY);
    footSrc.setData(env && env.footprint.length ? { type: "FeatureCollection", features: [feature(frame, regionToPolygons(env.footprint), { color })] } : EMPTY);
    return;
  }
  const feats = groupSlices(env).map(({ block, polys }) =>
    feature(frame, polys, { kind: block.beyond ? "beyond" : "solid", base: block.base, top: block.top, color }),
  );
  envSrc.setData({ type: "FeatureCollection", features: feats });
  footSrc.setData({ type: "FeatureCollection", features: [feature(frame, regionToPolygons(env.footprint), { color })] });
}

export function showGhost(
  map: MLMap,
  frame: Frame,
  ghost: { floor: number; zBase: number; zTop: number; polys: XY[][][] }[] | null,
  rule: RuleId | null,
) {
  const src = map.getSource("ghost") as GeoJSONSource;
  if (!ghost || !rule) return src.setData(EMPTY);
  src.setData({
    type: "FeatureCollection",
    features: ghost.map((g) => feature(frame, g.polys, { base: g.zBase + EPS, top: g.zTop, color: RULE_COLORS[rule] })),
  });
}

export function highlightEdge(map: MLMap, a: [number, number] | null, b?: [number, number]) {
  const src = map.getSource("edge-hl") as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(a && b ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [a, b] } } : EMPTY);
}
