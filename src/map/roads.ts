import { makeFrame, type LngLat, type XY } from "../geo/local";

export interface RoadSeg {
  a: XY;
  b: XY;
  cls: string;
  name: string;
  rowEst: number;
}

const DATA = `${import.meta.env.BASE_URL}data`;
let roads: GeoJSON.Feature<GeoJSON.LineString, { cls: string; name: string; row_est: number }>[] | null = null;

export async function loadRoads() {
  if (roads) return roads;
  const fc = await fetch(`${DATA}/roads.geojson`).then((r) => r.json());
  roads = fc.features;
  return roads!;
}

function distToSeg(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export interface Guess {
  edge: number;
  row: number;
  name: string;
  distance: number;
}

/**
 * Guess which plot edges front a road, and a default right-of-way from the OSM road class.
 * An edge counts as frontage when its midpoint is within (half the estimated ROW + 6 m) of a road centreline.
 * The user can always correct both (OSM has almost no width tags).
 */
export function guessFrontage(ring: LngLat[]): Guess[] {
  if (!roads || ring.length < 3) return [];
  const f = makeFrame(ring[0]);
  const xy = ring.map(f.toXY);
  const out: Guess[] = [];
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best: { d: number; row: number; name: string } | null = null;
    for (const r of roads) {
      const cs = r.geometry.coordinates;
      const p0 = f.toXY(cs[0] as LngLat);
      if (Math.abs(p0[0] - mid[0]) > 600 || Math.abs(p0[1] - mid[1]) > 600) continue;
      for (let k = 0; k < cs.length - 1; k++) {
        const d = distToSeg(mid, f.toXY(cs[k] as LngLat), f.toXY(cs[k + 1] as LngLat));
        if (!best || d < best.d) best = { d, row: r.properties.row_est, name: r.properties.name || `${r.properties.cls} road` };
      }
    }
    if (best && best.d <= best.row / 2 + 6) out.push({ edge: i, row: best.row, name: best.name, distance: best.d });
  }
  return out;
}

/** Distance in metres from each station to the plot polygon (0 when inside). */
export function nearestStationM(ring: LngLat[], stations: GeoJSON.Feature<GeoJSON.Point>[]): number | null {
  if (!stations.length || ring.length < 3) return null;
  const f = makeFrame(ring[0]);
  const xy = ring.map(f.toXY);
  let best = Infinity;
  for (const s of stations) {
    const p = f.toXY(s.geometry.coordinates as LngLat);
    for (let i = 0; i < xy.length; i++) best = Math.min(best, distToSeg(p, xy[i], xy[(i + 1) % xy.length]));
  }
  return Number.isFinite(best) ? best : null;
}
