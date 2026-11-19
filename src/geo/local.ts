/**
 * Local metric frame for plot-scale geometry.
 *
 * Equirectangular projection centred on the plot. At plot scale (< 1 km) in Bangkok
 * (lat ~13.7°) the distortion is well under 0.1 %, far below the precision of the rules.
 */
export type LngLat = [number, number];
export type XY = [number, number];

const M_PER_DEG_LAT = 110574;

export interface Frame {
  origin: LngLat;
  mx: number; // metres per degree of longitude at the origin
  toXY(p: LngLat): XY;
  toLngLat(p: XY): LngLat;
}

export function makeFrame(origin: LngLat): Frame {
  const mx = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    origin,
    mx,
    toXY: ([lng, lat]) => [(lng - origin[0]) * mx, (lat - origin[1]) * M_PER_DEG_LAT],
    toLngLat: ([x, y]) => [origin[0] + x / mx, origin[1] + y / M_PER_DEG_LAT],
  };
}

/** Signed area (shoelace); positive = counter-clockwise. */
export function signedArea(ring: XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(ring: XY[]): XY {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Ray-casting point-in-polygon. */
export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Circle polygon in lon/lat, radius in metres (for station catchments). */
export function circleLngLat(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const f = makeFrame(center);
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push(f.toLngLat([Math.cos(t) * radiusM, Math.sin(t) * radiusM]));
  }
  return ring;
}
