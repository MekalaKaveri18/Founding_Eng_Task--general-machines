/**
 * Planar region algebra on top of clipper2-js.
 *
 * clipper2-js 1.2.4 is used for boolean operations (union / difference / intersection) and areas.
 * Its InflatePaths (offset) is NOT used: in this build it applies half the requested distance and
 * returns malformed vertices for closed polygons (see tests/clipper-smoke.test.ts). Per-edge
 * inward offsets are instead built here as explicit strip polygons and subtracted with clipper.
 *
 * Coordinates are metres in a local frame. Clipper works on integers, so we scale to millimetres.
 */
import { Clipper, FillRule, Path64, Paths64, Point64 } from "clipper2-js";
import type { XY } from "../geo/local";

const S = 1000; // 1 m = 1000 clipper units
const AREA_DIV = S * S;

export type Region = Paths64; // outer rings + holes, clipper orientation conventions

export function ringToPath(ring: XY[]): Path64 {
  const p = new Path64();
  for (const [x, y] of ring) p.push(new Point64(Math.round(x * S), Math.round(y * S)));
  return p;
}

export function regionFromRing(ring: XY[]): Region {
  const r = new Paths64();
  r.push(ringToPath(ring));
  return r;
}

export function emptyRegion(): Region {
  return new Paths64();
}

export function regionArea(r: Region): number {
  return Math.abs(Clipper.areaPaths(r)) / AREA_DIV;
}

export function isEmpty(r: Region, minAreaM2 = 0.01): boolean {
  return r.length === 0 || regionArea(r) < minAreaM2;
}

/**
 * Deep copy. clipper2-js 1.2.4 MUTATES the Point64 objects of the paths it is given (and may return paths that share
 * them with its inputs), so a region reused across operations gets silently corrupted. Every boolean below therefore
 * works on private copies of its inputs. Outputs may share points only with those private copies, so they are safe
 * to hold and to pass into later operations (which copy again). Guarded by tests/immutability.test.ts.
 */
export function cloneRegion(r: Region): Region {
  const out = new Paths64();
  for (const path of r) {
    const q = new Path64();
    for (const pt of path) q.push(new Point64(pt.x, pt.y));
    out.push(q);
  }
  return out;
}

export function unionAll(parts: Region[]): Region {
  let acc = new Paths64();
  for (const p of parts) acc = Clipper.Union(acc, cloneRegion(p), FillRule.NonZero); // acc is already private: never handed out until the end
  return acc;
}

export function difference(a: Region, b: Region): Region {
  if (b.length === 0) return cloneRegion(a);
  return Clipper.Difference(cloneRegion(a), cloneRegion(b), FillRule.NonZero);
}

export function intersect(a: Region, b: Region): Region {
  return Clipper.Intersect(cloneRegion(a), cloneRegion(b), FillRule.NonZero);
}

/** Ensure counter-clockwise order (y up). */
export function toCCW(ring: XY[]): XY[] {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a < 0 ? [...ring].reverse() : ring;
}

export interface EdgeInfo {
  a: XY;
  b: XY;
  /** Unit direction a->b. */
  dir: XY;
  /** Unit inward normal (left of a->b for a CCW ring). */
  inward: XY;
  length: number;
}

export function edgesOf(ccwRing: XY[]): EdgeInfo[] {
  return ccwRing.map((a, i) => {
    const b = ccwRing[(i + 1) % ccwRing.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const dir: XY = [dx / length, dy / length];
    return { a, b, dir, inward: [-dir[1], dir[0]], length };
  });
}

/**
 * Rectangle covering the edge's extent and reaching `depth` metres inward.
 * Used for setbacks measured parallel to a road line.
 */
export function stripAlongEdge(e: EdgeInfo, depth: number): Region {
  const n = e.inward;
  const out: XY = [-n[0] * 1, -n[1] * 1]; // extend 1 m outward so the strip fully covers the boundary
  const ring: XY[] = [
    [e.a[0] + out[0], e.a[1] + out[1]],
    [e.b[0] + out[0], e.b[1] + out[1]],
    [e.b[0] + n[0] * depth, e.b[1] + n[1] * depth],
    [e.a[0] + n[0] * depth, e.a[1] + n[1] * depth],
  ];
  return regionFromRing(toCCW(ring));
}

/**
 * Half-plane of the edge's supporting line, `depth` metres inward, clipped to a large window.
 * Used for the 2:1 height plane, which extends along the whole road line, not just the plot edge.
 */
export function halfPlaneFromEdge(e: EdgeInfo, depth: number, reach = 3000): Region {
  const n = e.inward;
  const A: XY = [e.a[0] - e.dir[0] * reach, e.a[1] - e.dir[1] * reach];
  const B: XY = [e.b[0] + e.dir[0] * reach, e.b[1] + e.dir[1] * reach];
  const ring: XY[] = [
    [A[0] - n[0], A[1] - n[1]],
    [B[0] - n[0], B[1] - n[1]],
    [B[0] + n[0] * depth, B[1] + n[1] * depth],
    [A[0] + n[0] * depth, A[1] + n[1] * depth],
  ];
  return regionFromRing(toCCW(ring));
}

/** Disc (circumscribed polygon, so the real distance is never less than r). */
function disc(c: XY, r: number, n = 32): Region {
  const R = r / Math.cos(Math.PI / n);
  const ring: XY[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    ring.push([c[0] + Math.cos(t) * R, c[1] + Math.sin(t) * R]);
  }
  return regionFromRing(ring);
}

/**
 * Exact "distance to this boundary edge < d" zone: stadium = strip on both sides plus a disc at each end.
 * Used for side and rear boundary distances, which are measured to the boundary itself.
 */
export function bufferOfEdge(e: EdgeInfo, d: number): Region {
  const n = e.inward;
  const rect: XY[] = [
    [e.a[0] - n[0] * d, e.a[1] - n[1] * d],
    [e.b[0] - n[0] * d, e.b[1] - n[1] * d],
    [e.b[0] + n[0] * d, e.b[1] + n[1] * d],
    [e.a[0] + n[0] * d, e.a[1] + n[1] * d],
  ];
  return unionAll([regionFromRing(toCCW(rect)), disc(e.a, d), disc(e.b, d)]);
}


/** Region grown by d metres on every side (union of edge stadiums plus the region itself). Clipper's own offset is not used, see file header. */
export function bufferRegion(r: Region, d: number): Region {
  const parts: Region[] = [r];
  for (const path of r) {
    const ring: XY[] = path.map((p) => [p.x / S, p.y / S] as XY);
    if (ring.length < 3) continue;
    for (const e of edgesOf(ring)) if (e.length > 1e-6) parts.push(bufferOfEdge(e, d));
  }
  return unionAll(parts);
}

/** Group clipper output into polygons with holes, for rendering. Each polygon = [outer, ...holes], in metres. */
export function regionToPolygons(r: Region): XY[][][] {
  const outers: { ring: XY[]; holes: XY[][] }[] = [];
  const holes: XY[][] = [];
  for (const path of r) {
    const ring: XY[] = path.map((p) => [p.x / S, p.y / S] as XY);
    if (ring.length < 3) continue;
    if (Clipper.area(path) > 0) outers.push({ ring, holes: [] });
    else holes.push(ring);
  }
  for (const h of holes) {
    const probe = h[0];
    const host = outers.find((o) => inRing(probe, o.ring));
    if (host) host.holes.push(h);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


/** Total boundary length of a region (outer rings and holes), metres. */
export function perimeter(r: Region): number {
  let total = 0;
  for (const path of r) {
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      total += Math.hypot(b.x - a.x, b.y - a.y) / S;
    }
  }
  return total;
}

/** Point containment for polygons-with-holes (as returned by regionToPolygons). */
export function polygonsContain(polys: XY[][][], p: XY): boolean {
  for (const poly of polys) {
    if (!inRing(p, poly[0])) continue;
    if (poly.slice(1).some((h) => inRing(p, h))) continue;
    return true;
  }
  return false;
}

/** Point containment for a region with holes. Convert once with regionToPolygons when testing many points. */
export function regionContains(r: Region, p: XY): boolean {
  return polygonsContain(regionToPolygons(r), p);
}

/** Oriented rectangle in a local frame (origin o, axes u and v), as a region. */
export function orientedRect(o: XY, u: XY, v: XY, x0: number, x1: number, y0: number, y1: number): Region {
  const at = (x: number, y: number): XY => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y];
  return regionFromRing(toCCW([at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]));
}

/** Self-intersection check for a simple polygon (used to reject bad user input). */
export function isSelfIntersecting(ring: XY[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsCross(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
