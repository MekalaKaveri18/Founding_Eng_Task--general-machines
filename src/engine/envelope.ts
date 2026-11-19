import type { XY } from "../geo/local";
import {
  BIG_GFA, BONUS_ENERGY, BONUS_WATER_PER_UNIT, CORNER_OR_THROUGH_MAX_SPAN, EXTRA_LARGE_GFA, FLOOR_H,
  HEIGHT_PLANE_RATIO, HIGHRISE_FRONTAGE_LEN, HIGHRISE_ROAD_ROW, HIGHRISE_ROAD_ROW_BIG, HIGH_RISE_H,
  MAX_BONUS, MAX_FAR_HIGHRISE, MIN_PLATE_M2, SIDE_HIGHRISE, SIDE_LOWRISE, ZONES, roadSetbackFromBoundary,
  type BuildingUse, type ZoneId,
} from "./constants";
import {
  bufferOfEdge, bufferRegion, difference, edgesOf, halfPlaneFromEdge, isEmpty, regionArea, regionFromRing,
  regionToPolygons, stripAlongEdge, toCCW, unionAll, type EdgeInfo, type Region,
} from "./geom";

/** Rules the user can switch off to see what each one removes from the envelope. */
export type RuleId = "road-setback" | "boundary" | "height-plane" | "far-cap";
export const RULE_IDS: RuleId[] = ["road-setback", "boundary", "height-plane", "far-cap"];

export interface Frontage {
  /** Plot edge index (vertex i to i+1 of the ring as given). */
  edge: number;
  /** Right-of-way width, boundary to boundary (m). */
  row: number;
}

export interface Bonus {
  energyLevel: 0 | 1 | 2 | 3 | 4;
  /** Water retention in multiples of 1 m3 per 50 m2 of land (Plan art. 55). 0 = none. */
  waterUnits: number;
  /** Floor area of below-market / low-income housing provided in the project (m2). Plan art. 52. */
  affordableArea: number;
}

export interface PlotInput {
  ring: XY[]; // metres, local frame
  roads: Frontage[];
  zone: ZoneId;
  use: BuildingUse;
  bonus: Bonus;
  disabled: RuleId[];
}

export type Mode = "low" | "high";

export interface Slice {
  floor: number; // 1-based
  zBase: number;
  zTop: number;
  region: Region;
  area: number;
  cumulative: number;
}

export interface Envelope {
  mode: Mode;
  allowed: boolean;
  reason?: string;
  footprint: Region;
  slices: Slice[];
  /** Uncapped sum of all slice areas (geometric maximum). */
  geometricGfa: number;
  /** Floors fully inside the FAR cap (the floor after this one crosses the cap). */
  capFloor: number;
  /** Floors the allowed floor area actually reaches: capFloor, plus one partial floor if at least a minimum plate is left. */
  allowedFloors: number;
  /** Height of those floors (m). */
  allowedHeight: number;
  maxHeight: number;
  /** GFA actually allowed once FAR (and the 10:1 / 10,000 m2 limits) are applied. */
  allowedGfa: number;
  gfaCap: number;
}

export interface FarResult {
  baseFar: number;
  bonusPct: number;
  bonusBreakdown: { energy: number; water: number; affordable: number; capped: boolean };
  effectiveFar: number;
}

export function farFor(zone: ZoneId, bonus: Bonus, siteArea: number): FarResult {
  const baseFar = ZONES[zone].far;
  const baseGfa = baseFar * siteArea;
  const energy = BONUS_ENERGY[bonus.energyLevel];
  const water = Math.min(MAX_BONUS, Math.max(0, bonus.waterUnits) * BONUS_WATER_PER_UNIT);
  const affordable = baseGfa > 0 ? Math.min(MAX_BONUS, (4 * Math.max(0, bonus.affordableArea)) / baseGfa) : 0;
  const sum = energy + water + affordable;
  const bonusPct = Math.min(MAX_BONUS, sum); // Plan art. 57
  return {
    baseFar,
    bonusPct,
    bonusBreakdown: { energy, water, affordable, capped: sum > MAX_BONUS },
    effectiveFar: baseFar * (1 + bonusPct),
  };
}

export function prepare(input: PlotInput) {
  const reversed = toCCWFlag(input.ring);
  const ring = reversed ? [...input.ring].reverse() : input.ring;
  const n = ring.length;
  // When the ring is reversed, edge i (i -> i+1) becomes edge (n - 2 - i) mod n
  const mapEdge = (e: number) => (reversed ? (n - 2 - e + n) % n : e);
  const roads = input.roads.map((r) => ({ ...r, edge: mapEdge(r.edge) }));
  const edges = edgesOf(ring);
  const site = regionFromRing(ring);
  return { ring, edges, roads, site, siteArea: regionArea(site) };
}

function toCCWFlag(ring: XY[]): boolean {
  return toCCW(ring) !== ring;
}

/**
 * High-rise access gate, MR 33 art. 2.
 * Needs a plot side of at least 12 m on a public road of at least 10 m right-of-way. A building over 30,000 m2
 * needs the road to be at least 18 m; on a 10-18 m road a high-rise is still allowed, capped at 30,000 m2.
 */
export function highRiseGate(edges: EdgeInfo[], roads: Frontage[]) {
  const rows = roads.filter((r) => edges[r.edge] && edges[r.edge].length >= HIGHRISE_FRONTAGE_LEN).map((r) => r.row);
  const best = rows.length ? Math.max(...rows) : 0;
  const ok = best >= HIGHRISE_ROAD_ROW;
  return {
    ok,
    needRow: HIGHRISE_ROAD_ROW,
    /** Largest total floor area the road allows. */
    maxGfa: best >= HIGHRISE_ROAD_ROW_BIG ? Infinity : BIG_GFA,
    reason: ok
      ? undefined
      : `MR 33 art. 2: a high-rise or extra-large building needs a plot side of at least ${HIGHRISE_FRONTAGE_LEN} m on a public road with a right-of-way of at least ${HIGHRISE_ROAD_ROW} m.`,
  };
}

/** Distance from the road's opposite boundary line for the height plane: edge line shifted by ROW. */
function planeRoads(edges: EdgeInfo[], roads: Frontage[], disabled: Set<RuleId>) {
  if (disabled.has("height-plane") || roads.length === 0) return [] as { edge: EdgeInfo; row: number }[];
  const withEdge = roads.filter((r) => edges[r.edge]).map((r) => ({ edge: edges[r.edge], row: r.row, index: r.edge }));
  if (withEdge.length <= 1) return withEdge;
  // MR 55 art. 46 (corner) and art. 45 (two roads, <= 60 m apart): the wider road governs.
  const n = edges.length;
  const adjacent = (a: number, b: number) => (a + 1) % n === b || (b + 1) % n === a;
  const widest = withEdge.reduce((m, r) => (r.row > m.row ? r : m));
  const everyCorner = withEdge.every((r) => r.index === widest.index || adjacent(r.index, widest.index));
  const spanOk = withEdge.every((r) => Math.abs(distanceBetweenLines(r.edge, widest.edge)) <= CORNER_OR_THROUGH_MAX_SPAN);
  return everyCorner || spanOk ? [widest] : withEdge; // otherwise be conservative: every road's plane applies
}

function distanceBetweenLines(a: EdgeInfo, b: EdgeInfo): number {
  // Distance from edge b's midpoint to the line through edge a.
  const m: XY = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2];
  return (m[0] - a.a[0]) * a.inward[0] + (m[1] - a.a[1]) * a.inward[1];
}

/** Ground footprint allowed for a building of this kind (before the height plane). */
export function footprintFor(mode: Mode, p: ReturnType<typeof prepare>, disabled: Set<RuleId>): Region {
  const roadEdge = new Map(p.roads.map((r) => [r.edge, r.row]));
  const cuts: Region[] = [];
  p.edges.forEach((e, i) => {
    if (roadEdge.has(i)) {
      if (disabled.has("road-setback")) return;
      // High-rise: 6 m from the public road (MR 33 art. 4). Otherwise MR 55 art. 41 / Ord 44 art. 50.
      const d = mode === "high" ? SIDE_HIGHRISE : roadSetbackFromBoundary(roadEdge.get(i)!);
      if (d > 0) cuts.push(stripAlongEdge(e, d));
    } else {
      if (disabled.has("boundary")) return;
      cuts.push(bufferOfEdge(e, mode === "high" ? SIDE_HIGHRISE : SIDE_LOWRISE));
    }
  });
  return difference(p.site, unionAll(cuts));
}

export function computeEnvelope(input: PlotInput, mode: Mode): Envelope {
  const p = prepare(input);
  const disabled = new Set(input.disabled);
  const far = farFor(input.zone, input.bonus, p.siteArea);
  const farGfa = far.effectiveFar * p.siteArea;
  const farOn = !disabled.has("far-cap");

  let gfaCap = farOn ? farGfa : Infinity;
  if (mode === "high") gfaCap = Math.min(gfaCap, MAX_FAR_HIGHRISE * p.siteArea); // MR 33 art. 5
  if (mode === "low") gfaCap = Math.min(gfaCap, EXTRA_LARGE_GFA - 1); // else it becomes extra-large (MR 33)

  const empty = (reason: string): Envelope => ({
    mode, allowed: false, reason, footprint: unionAll([]), slices: [], geometricGfa: 0, capFloor: 0,
    allowedFloors: 0, allowedHeight: 0, maxHeight: 0, allowedGfa: 0, gfaCap,
  });

  if (mode === "high") {
    const gate = highRiseGate(p.edges, p.roads);
    if (!gate.ok) return empty(gate.reason!);
    gfaCap = Math.min(gfaCap, gate.maxGfa); // MR 33 art. 2: over 30,000 m2 needs an 18 m road
  }

  const footprint = footprintFor(mode, p, disabled);
  if (isEmpty(footprint, MIN_PLATE_M2)) {
    return { ...empty("Setbacks leave no buildable footprint on this plot."), footprint };
  }

  const planes = planeRoads(p.edges, p.roads, disabled);
  const maxFloors = mode === "low" ? Math.floor((HIGH_RISE_H - 1e-9) / FLOOR_H) : 120;
  const slices: Slice[] = [];
  let cumulative = 0;
  for (let k = 1; k <= maxFloors; k++) {
    const zTop = k * FLOOR_H;
    let region = footprint;
    for (const pl of planes) {
      // Height z is allowed at inward distance t from the road edge when z <= 2 (ROW + t), i.e. t >= z/2 - ROW.
      const depth = zTop / HEIGHT_PLANE_RATIO - pl.row;
      if (depth > 0) region = difference(region, halfPlaneFromEdge(pl.edge, depth));
    }
    if (isEmpty(region, MIN_PLATE_M2)) break;
    const area = regionArea(region);
    cumulative += area;
    slices.push({ floor: k, zBase: (k - 1) * FLOOR_H, zTop, region, area, cumulative });
  }

  const geometricGfa = cumulative;
  let capFloor = slices.length;
  if (Number.isFinite(gfaCap)) {
    capFloor = slices.filter((s) => s.cumulative <= gfaCap).length;
  }
  let allowedFloors = capFloor;
  if (capFloor < slices.length) {
    const used = capFloor ? slices[capFloor - 1].cumulative : 0;
    if (gfaCap - used >= MIN_PLATE_M2) allowedFloors = capFloor + 1; // a partial top floor
  }
  return {
    mode,
    allowedFloors,
    allowedHeight: allowedFloors * FLOOR_H,
    allowed: slices.length > 0,
    reason: slices.length ? undefined : "The height plane leaves no usable floor.",
    footprint,
    slices,
    geometricGfa,
    capFloor,
    maxHeight: slices.length ? slices[slices.length - 1].zTop : 0,
    allowedGfa: Math.min(geometricGfa, gfaCap),
    gfaCap,
  };
}

export const GHOST_GAP = 0.05; // metres

/** The volume a single rule removes: floor-by-floor difference between "rule off" and "all rules on". */
export function ghostFor(input: PlotInput, mode: Mode, rule: RuleId): { floor: number; zBase: number; zTop: number; polys: XY[][][] }[] {
  const on = computeEnvelope(input, mode);
  const without = computeEnvelope({ ...input, disabled: input.disabled.filter((d) => d !== rule).concat(rule) }, mode);
  const out: { floor: number; zBase: number; zTop: number; polys: XY[][][] }[] = [];
  for (const s of without.slices) {
    const mine = on.slices.find((t) => t.floor === s.floor);
    // Keep a 5 cm gap from the envelope's walls so ghost and envelope faces are never coincident (no z-fighting).
    const gone = mine ? difference(difference(s.region, mine.region), bufferRegion(mine.region, GHOST_GAP)) : s.region;
    if (!isEmpty(gone, 0.5)) out.push({ floor: s.floor, zBase: s.zBase, zTop: s.zTop, polys: regionToPolygons(gone) });
  }
  return out;
}

