/**
 * Concept designs inside the allowed envelope.
 *
 * Each design is a stack of floor plates. A plate is a rectangle aligned to the frontage edge (the widest road),
 * intersected with that floor's allowable slice from the envelope. Because every plate is cut by the slice,
 * the setbacks and the 2:1 height plane hold by construction; the checklist still verifies them independently.
 * No inscribed-rectangle solver is used: rectangles come from the bounding box of the footprint in the
 * frontage-aligned frame, trimmed so ground coverage leaves the open space the zone requires.
 */
import type { XY } from "../geo/local";
import {
  AVG_UNIT, BETWEEN_BUILDINGS, FLOOR_H, FRONT_SPACE_PERIMETER_SHARE, FRONT_SPACE_W, MIN_PLATE_M2, NET_EFFICIENCY, PARKING_AREA_PER_BAY,
  PERMEABLE_SHARE, SHARE_UNITS_60, type BuildingUse,
} from "./constants";
import { prepare, type Envelope, type PlotInput } from "./envelope";
import {
  difference, intersect, orientedRect, perimeter, regionArea, regionContains, regionToPolygons, unionAll, type EdgeInfo, type Region,
} from "./geom";
import { parkingRequired } from "./parking";
import { openSpaceRequired, roadTier, useLimits, type Analysis } from "./rules";

export type SchemeKind = "tower" | "slab" | "twin" | "block" | "garden";
export type PartUse = "parking" | "residential" | "office" | "hotel";

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FloorPart {
  use: PartUse;
  region: Region;
  area: number;
}

export interface SchemeFloor {
  floor: number;
  zBase: number;
  zTop: number;
  parts: FloorPart[];
  area: number;
  cumulative: number;
}

export interface CheckRow {
  id: string;
  label: string;
  value: string;
  limit: string;
  /** null = not applicable to this design */
  pass: boolean | null;
  source: string;
  note?: string;
}

export interface Scheme {
  kind: SchemeKind;
  name: string;
  blurb: string;
  mode: "low" | "high";
  feasible: boolean;
  reason?: string;
  floors: SchemeFloor[];
  gfa: number;
  height: number;
  groundCoverage: number;
  podiumFloors: number;
  usableGfa: number;
  units: number;
  unitLabel: string;
  parkingRequired: number;
  parkingProvided: number;
  checks: CheckRow[];
  /** True when every applicable check passes. */
  passes: boolean;
}

const MAX_PODIUM = 8;
const TOWER_TARGET_M2 = 1100;
const SLAB_DEPTH = 22;
const TWIN_MAX_W = 30;
const MIN_TWIN_W = 16;
const DRIVE_TURN_M2 = 150; // driveway turning area (assumption)
const DRIVE_W = 6;
// Clipper works in whole millimetres; rotated edges can leave slivers of about 1 mm x the plate's perimeter.
const LEAK_TOLERANCE_M2 = 0.5;

const n0 = (x: number) => Math.round(x).toLocaleString("en");
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

interface Frame {
  o: XY;
  u: XY;
  v: XY;
  edge: EdgeInfo;
  len: number;
}

function frameFor(edges: EdgeInfo[], roads: { edge: number; row: number }[]): Frame | null {
  if (!roads.length) return null;
  const best = [...roads].sort((a, b) => b.row - a.row || edges[b.edge].length - edges[a.edge].length)[0];
  const e = edges[best.edge];
  return { o: e.a, u: e.dir, v: e.inward, edge: e, len: e.length };
}

function toLocal(f: Frame, p: XY): XY {
  const dx = p[0] - f.o[0];
  const dy = p[1] - f.o[1];
  return [dx * f.u[0] + dy * f.u[1], dx * f.v[0] + dy * f.v[1]];
}

function bboxLocal(f: Frame, region: Region): Rect | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of regionToPolygons(region)) {
    for (const p of poly[0]) {
      const [x, y] = toLocal(f, p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
}

const regionOf = (f: Frame, r: Rect): Region => orientedRect(f.o, f.u, f.v, r.x0, r.x1, r.y0, r.y1);
const rectArea = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

/** Rectangle from the footprint's frontage-aligned bounding box, scaled about its front-centre. */
function scaled(bb: Rect, yFront: number, s: number): Rect {
  const cx = (bb.x0 + bb.x1) / 2;
  const w = (bb.x1 - bb.x0) * s;
  return { x0: cx - w / 2, x1: cx + w / 2, y0: yFront, y1: yFront + Math.max(0, bb.y1 - yFront) * s };
}

/** Largest scale s in (0,1] whose rectangle, cut by the ground slice, covers no more than maxCover. */
function fitCoverage(f: Frame, bb: Rect, yFront: number, ground: Region, maxCover: number): { rect: Rect; scale: number } {
  const cover = (s: number) => regionArea(intersect(regionOf(f, scaled(bb, yFront, s)), ground));
  if (cover(1) <= maxCover) return { rect: scaled(bb, yFront, 1), scale: 1 };
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cover(mid) <= maxCover) lo = mid;
    else hi = mid;
  }
  return { rect: scaled(bb, yFront, lo), scale: lo };
}

interface Layout {
  podium: Rect;
  towers: Rect[];
  /** Where parking floors sit: a podium under the towers. */
  note?: string;
}

function residentialUse(use: BuildingUse): PartUse {
  return use === "office" ? "office" : use === "hotel" ? "hotel" : "residential";
}

interface Stack {
  floors: SchemeFloor[];
  gfa: number;
  parkingArea: number;
  usableGfa: number;
}

function buildStack(f: Frame, env: Envelope, lay: Layout, P: number, cap: number, use: BuildingUse, usableCap: number): Stack {
  const floors: SchemeFloor[] = [];
  let cum = 0;
  let parkingArea = 0;
  const resUse = residentialUse(use);
  for (let k = 1; k <= env.slices.length; k++) {
    const slice = env.slices[k - 1];
    const podium = k <= P;
    const specs: { use: PartUse; rect: Rect }[] = podium
      ? [{ use: "parking", rect: lay.podium }]
      : lay.towers.map((r) => ({ use: resUse, rect: r }));
    const make = (rects: { use: PartUse; rect: Rect }[]) =>
      rects
        .map((sp) => {
          const region = intersect(regionOf(f, sp.rect), slice.region);
          return { use: sp.use, region, area: regionArea(region) };
        })
        .filter((p) => p.area >= MIN_PLATE_M2);
    let parts = make(specs);
    let area = parts.reduce((a, p) => a + p.area, 0);
    if (!parts.length) break;
    // Room left: the total floor area cap, and (above the parking podium) the use limit on usable floor area.
    const room = Math.min(cap - cum, podium ? Infinity : usableCap - (cum - parkingArea));
    if (area > room + 1e-6) {
      // Partial top floor: shrink each rectangle's depth from the rear until the total fits the remaining allowance.
      const remaining = room;
      if (remaining < MIN_PLATE_M2) break;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const trial = make(specs.map((sp) => ({ use: sp.use, rect: { ...sp.rect, y0: sp.rect.y1 - (sp.rect.y1 - sp.rect.y0) * mid } })));
        if (trial.reduce((a, p) => a + p.area, 0) <= remaining) lo = mid;
        else hi = mid;
      }
      parts = make(specs.map((sp) => ({ use: sp.use, rect: { ...sp.rect, y0: sp.rect.y1 - (sp.rect.y1 - sp.rect.y0) * lo } })));
      area = parts.reduce((a, p) => a + p.area, 0);
      if (area < MIN_PLATE_M2) break;
      cum += area;
      floors.push({ floor: k, zBase: (k - 1) * FLOOR_H, zTop: k * FLOOR_H, parts, area, cumulative: cum });
      if (podium) parkingArea += area;
      break;
    }
    cum += area;
    floors.push({ floor: k, zBase: (k - 1) * FLOOR_H, zTop: k * FLOOR_H, parts, area, cumulative: cum });
    if (podium) parkingArea += area;
  }
  return { floors, gfa: cum, parkingArea, usableGfa: cum - parkingArea };
}

function frontClearLength(f: Frame, ground: Region, depth: number): number {
  const step = 0.5;
  let clear = 0;
  for (let x = step / 2; x < f.len; x += step) {
    let blocked = false;
    for (let y = step / 2; y < depth && !blocked; y += step) {
      const p: XY = [f.o[0] + f.u[0] * x + f.v[0] * y, f.o[1] + f.v[1] * y + f.u[1] * x];
      if (regionContains(ground, p)) blocked = true;
    }
    if (!blocked) clear += step;
  }
  return clear;
}

interface Def {
  kind: SchemeKind;
  mode: "low" | "high";
  name: string;
  blurb: string;
}

export function designSchemes(input: PlotInput, a: Analysis, stationM: number | null = null): Scheme[] {
  const p = prepare(input);
  const f = frameFor(p.edges, p.roads);
  if (!f) return [];
  const defs: Def[] = a.high.allowed
    ? [
        { kind: "tower", mode: "high", name: "Tower on podium", blurb: "One slender tower above a parking podium; the most open ground." },
        { kind: "slab", mode: "high", name: "Slab on podium", blurb: "A long double-loaded bar parallel to the road above a parking podium." },
        { kind: "twin", mode: "high", name: "Twin towers", blurb: "Two towers on a shared podium; lower and wider than a single tower." },
        { kind: "block", mode: "low", name: "Low-rise block", blurb: "Under 23 m, so the lighter low-rise rules apply; no high-rise gate." },
      ]
    : [
        { kind: "block", mode: "low", name: "Low-rise block", blurb: "The largest low-rise block that leaves the required open space." },
        { kind: "garden", mode: "low", name: "Garden block", blurb: "About 40 % less ground coverage than the block: less floor area, more planting and light." },
      ];
  return defs.map((d) => makeScheme(input, a, p, f, d, stationM));
}

function infeasible(d: Def, reason: string): Scheme {
  return {
    ...d, feasible: false, reason, floors: [], gfa: 0, height: 0, groundCoverage: 0, podiumFloors: 0, usableGfa: 0,
    units: 0, unitLabel: "units", parkingRequired: 0, parkingProvided: 0, checks: [], passes: false,
  };
}

function makeScheme(input: PlotInput, a: Analysis, p: ReturnType<typeof prepare>, f: Frame, d: Def, stationM: number | null): Scheme {
  const env = a[d.mode];
  if (!env.allowed) return infeasible(d, env.reason ?? "No buildable envelope in this mode.");
  const ground = env.slices[0].region;
  const bb = bboxLocal(f, env.footprint);
  if (!bb) return infeasible(d, "No footprint.");
  const site = p.siteArea;
  const storeysOver3 = env.slices.length > 3;
  const yFront = storeysOver3 ? Math.max(FRONT_SPACE_W, bb.y0) : bb.y0; // Ord 44 art. 52(6): 12 m front space above 3 storeys
  if (bb.y1 - yFront < 8) return infeasible(d, `Not enough depth: the ${FRONT_SPACE_W} m front open space leaves under 8 m for a building.`);

  const target = env.gfaCap === Infinity ? env.geometricGfa : Math.min(env.gfaCap, env.geometricGfa);
  const needOpen = openSpaceRequired(input.zone, input.use, site, Math.max(target, 1)).required;
  let maxCover = Math.max(0, site - needOpen);
  if (d.kind === "garden") {
    // A garden block keeps at most 60 % of the ground plate the full block would use.
    maxCover = Math.min(maxCover, 0.6 * regionArea(intersect(regionOf(f, scaled(bb, yFront, 1)), ground)), 0.5 * site);
  }
  const fit = fitCoverage(f, bb, yFront, ground, maxCover);
  const pod = fit.rect;
  const pw = pod.x1 - pod.x0;
  const pd = pod.y1 - pod.y0;
  if (pw < 8 || pd < 8) return infeasible(d, "The open-space requirement leaves no room for a building of usable size.");

  let lay: Layout;
  if (d.kind === "tower") {
    const area = Math.min(TOWER_TARGET_M2, 0.62 * rectArea(pod));
    const tw = Math.min(pw, Math.max(20, Math.sqrt(area * 1.5)));
    const td = Math.min(pd, area / tw);
    const cx = (pod.x0 + pod.x1) / 2;
    lay = { podium: pod, towers: [{ x0: cx - tw / 2, x1: cx + tw / 2, y0: pod.y1 - td, y1: pod.y1 }] };
  } else if (d.kind === "slab") {
    const td = Math.min(SLAB_DEPTH, pd);
    const tw = Math.min(pw, 80);
    const cx = (pod.x0 + pod.x1) / 2;
    lay = { podium: pod, towers: [{ x0: cx - tw / 2, x1: cx + tw / 2, y0: pod.y1 - td, y1: pod.y1 }] };
  } else if (d.kind === "twin") {
    const gap = BETWEEN_BUILDINGS;
    const tw = Math.min(TWIN_MAX_W, (pw - gap) / 2);
    if (tw < MIN_TWIN_W) return infeasible(d, `The plot is too narrow for two towers: each needs at least ${MIN_TWIN_W} m plus a ${gap} m gap.`);
    const td = Math.min(pd, 26);
    const cx = (pod.x0 + pod.x1) / 2;
    lay = {
      podium: pod,
      towers: [
        { x0: cx - gap / 2 - tw, x1: cx - gap / 2, y0: pod.y1 - td, y1: pod.y1 },
        { x0: cx + gap / 2, x1: cx + gap / 2 + tw, y0: pod.y1 - td, y1: pod.y1 },
      ],
    };
  } else {
    lay = { podium: pod, towers: [pod] }; // block / garden: one plate, parking on the lowest floors
  }

  // Choose the fewest parking floors that supply the required spaces.
  const cap = env.gfaCap === Infinity ? env.geometricGfa : env.gfaCap;
  let best: { P: number; st: Stack; req: number; prov: number; units: number } | null = null;
  for (let P = 1; P <= MAX_PODIUM; P++) {
    const st = buildStack(f, env, lay, P, cap, input.use, a.usableCap);
    if (!st.floors.length || st.floors.length < P) break;
    const net = st.usableGfa * NET_EFFICIENCY;
    const units = AVG_UNIT[input.use] > 0 ? Math.floor(net / AVG_UNIT[input.use]) : 0;
    const req = parkingRequired({ use: input.use, gfaExParking: st.usableGfa, units60: Math.floor(units * SHARE_UNITS_60[input.use]), rooms: input.use === "hotel" ? units : 0 }).required;
    const prov = Math.floor(st.parkingArea / PARKING_AREA_PER_BAY);
    const cand = { P, st, req, prov, units };
    if (!best || prov / Math.max(req, 1) > best.prov / Math.max(best.req, 1)) best = cand;
    if (prov >= req) {
      best = cand;
      break;
    }
  }
  if (!best) return infeasible(d, "No floor of usable size fits the envelope.");
  const { P, st, req, prov, units } = best;

  const groundPlate = st.floors[0].parts.map((x) => x.region);
  const groundU = unionAll(groundPlate);
  const coverage = regionArea(groundU);
  const gfa = st.gfa;
  const open = site - coverage;
  const needAtGfa = openSpaceRequired(input.zone, input.use, site, gfa);
  const farEff = a.far.effectiveFar;
  const tier = roadTier(p.edges, p.roads);
  const checks: CheckRow[] = [];

  checks.push({
    id: "far", label: "Floor area ratio", value: `${n0(gfa)} m² (${(gfa / site).toFixed(2)} : 1)`,
    limit: `≤ ${n0(env.gfaCap === Infinity ? gfa : env.gfaCap)} m²${d.mode === "high" ? ` (zone ${farEff.toFixed(2)} : 1, hard 10 : 1)` : ` (zone ${farEff.toFixed(2)} : 1, under 10,000 m²)`}`,
    pass: gfa <= env.gfaCap + 1e-6, source: "Plan arts. 15-17, 57; MR 33 art. 5",
    note: "Car parking floors count toward floor area in this tool.",
  });

  let leak = 0;
  for (const fl of st.floors) {
    const slice = env.slices[fl.floor - 1];
    for (const part of fl.parts) leak += regionArea(difference(part.region, slice.region));
  }
  const insideEnvelope = leak < LEAK_TOLERANCE_M2;
  checks.push({
    id: "envelope", label: "Inside the allowed envelope on every floor", value: insideEnvelope ? "yes" : `${leak.toFixed(1)} m² outside`,
    limit: "setbacks + 2:1 height plane", pass: insideEnvelope, source: "MR 55 arts. 41, 44, 50; MR 33 art. 4",
  });
  checks.push({
    id: "open-space", label: "Open space", value: `${n0(open)} m² (${pct(open / site)} of the plot)`,
    limit: `≥ ${n0(needAtGfa.required)} m² (${needAtGfa.binding === "osr" ? "zone OSR" : `${(needAtGfa.landPct * 100).toFixed(0)} % of land`})`,
    pass: open >= needAtGfa.required - 1e-6, source: "MR 33 art. 6, Ord 44 art. 52, Plan arts. 15-17",
  });
  checks.push({
    id: "osr", label: "Open space ratio (open space ÷ floor area)", value: pct(open / gfa),
    limit: `≥ ${pct(needAtGfa.osrPct)}`, pass: open / gfa >= needAtGfa.osrPct - 1e-9, source: "Plan arts. 15-17",
  });
  const driveway = DRIVE_W * yFront + DRIVE_TURN_M2;
  const planting = open - driveway;
  const plantingNeeded = PERMEABLE_SHARE * needAtGfa.osrRequired;
  checks.push({
    id: "planting", label: "Planting on permeable ground", value: `${n0(Math.max(0, planting))} m²`,
    limit: `≥ ${n0(plantingNeeded)} m² (half of the OSR open space)`, pass: planting >= plantingNeeded - 1e-6,
    source: "Plan arts. 15-17", note: `Assumes ${n0(driveway)} m² of driveway and turning area (6 m drive to the building plus 150 m²).`,
  });
  checks.push({
    id: "parking", label: "Car parking", value: `${prov} spaces provided in ${P} podium floor${P === 1 ? "" : "s"}`,
    limit: `≥ ${req} spaces`, pass: prov >= req, source: "Ord 44 arts. 83-88, MR 7 art. 3",
    note: "Bay 2.40 × 5.00 m, 6 m aisle: about 30 m² of floor per space.",
  });

  const floorsN = st.floors.length;
  if (floorsN > 3) {
    const perim = perimeter(groundU);
    const clear = frontClearLength(f, groundU, FRONT_SPACE_W);
    const need = perim * FRONT_SPACE_PERIMETER_SHARE;
    checks.push({
      id: "front-space", label: `Front open space (${FRONT_SPACE_W} m deep)`, value: `${clear.toFixed(1)} m of the road frontage is clear`,
      limit: `≥ ${need.toFixed(1)} m (1/6 of the ${perim.toFixed(0)} m building perimeter)`, pass: clear >= need - 1e-6, source: "Ord 44 art. 52(6)",
      note: "Assumes a 6 m internal road connects this space to the public road.",
    });
  } else {
    checks.push({ id: "front-space", label: "Front open space", value: "not needed", limit: "3 storeys or fewer", pass: null, source: "Ord 44 art. 52(6)" });
  }

  if (d.mode === "high") {
    const gate = a.rows.find((r) => r.id === "access");
    checks.push({
      id: "access", label: "High-rise access (12 m frontage, wide enough road)", value: gate?.value ?? "satisfied", limit: "MR 33 art. 2",
      pass: gate ? gate.status !== "blocked" : true, source: "MR 33 art. 2",
    });
    checks.push({
      id: "fire-road", label: "6 m clear all round the building", value: "6 m setback on every side",
      limit: "≥ 6 m from every boundary and road", pass: insideEnvelope, source: "MR 33 arts. 3-4",
      note: "The road may be grass-paved; it must stay free of structures.",
    });
  } else {
    checks.push({ id: "access", label: "High-rise access gate", value: "not needed", limit: "under 23 m", pass: null, source: "MR 33 art. 2" });
  }

  if (d.kind === "twin") {
    const t = lay.towers;
    const gap = t[1].x0 - t[0].x1;
    checks.push({ id: "spacing", label: "Gap between the two towers", value: `${gap.toFixed(1)} m`, limit: `≥ ${BETWEEN_BUILDINGS} m`, pass: gap >= BETWEEN_BUILDINGS - 1e-6, source: "MR 55 art. 48 (applied as a minimum)" });
  }

  const ul = useLimits(input.use, tier, stationM);
  if (input.use === "office") {
    checks.push({ id: "use", label: "Office floor area for this plot", value: `${n0(st.usableGfa)} m²`, limit: `≤ ${Number.isFinite(ul.maxGfa) ? n0(ul.maxGfa) + " m²" : "no limit"}`, pass: st.usableGfa <= ul.maxGfa + 1e-6, source: ul.source });
  } else if (input.use === "hotel") {
    const ok = units <= 50 || tier >= 16 || (stationM !== null && stationM <= 500);
    checks.push({ id: "use", label: "Hotel size for this plot", value: `${units} rooms`, limit: "≤ 50 rooms unless road ROW ≥ 16 m or within 500 m of a rail station", pass: ok, source: ul.source });
  }

  const passes = checks.every((c) => c.pass !== false);
  const unitLabel = input.use === "hotel" ? "rooms" : input.use === "office" ? "m² net office" : "units";
  return {
    ...d, feasible: true, floors: st.floors, gfa, height: floorsN * FLOOR_H, groundCoverage: coverage, podiumFloors: P,
    usableGfa: st.usableGfa, units: input.use === "office" ? Math.floor(st.usableGfa * NET_EFFICIENCY) : units, unitLabel,
    parkingRequired: req, parkingProvided: prov, checks, passes,
  };
}
