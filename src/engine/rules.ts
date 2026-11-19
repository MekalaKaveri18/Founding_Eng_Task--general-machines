import {
  FIRE_ROAD_W, FRONT_SPACE_PERIMETER_SHARE, FRONT_SPACE_W, HIGH_RISE_H, MAX_FAR_HIGHRISE, OPEN_SPACE_OTHER,
  OPEN_SPACE_RESIDENTIAL, PERMEABLE_SHARE, SIDE_HIGHRISE, SIDE_LOWRISE, ZONES, roadSetbackFromBoundary,
  type BuildingUse, type ZoneId,
} from "./constants";
import { computeEnvelope, farFor, highRiseGate, prepare, type Envelope, type PlotInput, type RuleId } from "./envelope";
import type { EdgeInfo } from "./geom";

export interface OpenSpace {
  landPct: number;
  landRequired: number;
  osrPct: number;
  osrRequired: number;
  required: number;
  binding: "land" | "osr";
  permeableMin: number;
  /** Largest share of the site a building may cover at ground level. */
  maxCoverage: number;
}

/**
 * Open space needed for a given total floor area.
 * Two tests apply and the larger one binds:
 *  - share of the LAND area: 30 % residential, 10 % other (MR 33 art. 6, Ord 44 art. 52)
 *  - OSR of the zone x total floor area (Plan arts. 15-17); in ย.10 that is 4 % x 8 = 32 % of the site at full FAR.
 */
export function openSpaceRequired(zone: ZoneId, use: BuildingUse, siteArea: number, gfa: number): OpenSpace {
  const residential = use === "condo" || use === "rental";
  const landPct = residential ? OPEN_SPACE_RESIDENTIAL : OPEN_SPACE_OTHER;
  const landRequired = landPct * siteArea;
  const osrPct = ZONES[zone].osr;
  const osrRequired = osrPct * gfa;
  const required = Math.max(landRequired, osrRequired);
  return {
    landPct, landRequired, osrPct, osrRequired, required,
    binding: osrRequired > landRequired ? "osr" : "land",
    permeableMin: PERMEABLE_SHARE * osrRequired,
    maxCoverage: Math.max(0, siteArea - required),
  };
}

/** Best road class the plot satisfies for Plan art. 36 (frontage length and right-of-way). Continuity of the road is assumed. */
export function roadTier(edges: EdgeInfo[], roads: { edge: number; row: number }[]): 0 | 10 | 12 | 16 | 30 {
  let best: 0 | 10 | 12 | 16 | 30 = 0;
  for (const r of roads) {
    const e = edges[r.edge];
    if (!e) continue;
    const t: 0 | 10 | 12 | 16 | 30 =
      r.row >= 30 && e.length >= 30 ? 30 : r.row >= 16 && e.length >= 16 ? 16 : r.row >= 12 && e.length >= 12 ? 12 : r.row >= 10 && e.length >= 12 ? 10 : 0;
    if (t > best) best = t;
  }
  return best;
}

export interface UseLimits {
  allowed: boolean;
  /** Largest total floor area permitted for the use (Infinity = no use-specific limit). */
  maxGfa: number;
  note: string;
  source: string;
}

/**
 * Use restrictions in ย.8-ย.10 (Plan art. 15-17, the "prohibited unless" lists).
 * Residential is unrestricted. Hotels over 50 rooms and offices over 1,000 m2 are prohibited unless the plot
 * is on a wide enough road or within 500 m of a rail station platform.
 */
export function useLimits(use: BuildingUse, tier: number, stationM: number | null): UseLimits {
  const near = stationM !== null && stationM <= 500;
  if (use === "condo" || use === "rental") {
    return { allowed: true, maxGfa: Infinity, note: "Residential use is not restricted in ย.8-ย.10.", source: "Plan arts. 15-17" };
  }
  if (use === "hotel") {
    const ok = tier >= 16 || near;
    return {
      allowed: true,
      maxGfa: Infinity,
      note: ok
        ? "Hotels over 50 rooms are allowed here (road >= 16 m or within 500 m of a rail station)."
        : "Hotels are limited to 50 rooms unless the plot is on a road with ROW >= 16 m or within 500 m of a rail station.",
      source: "Plan art. 15(8) / 16(8) / 17(8)",
    };
  }
  // office
  const tiers: [number, number][] = [[1000, 0], [2000, 12], [5000, 16], [10000, 30]];
  let cap = 1000;
  for (const [limit, need] of tiers) if (limit > cap && (tier >= need || near)) cap = limit;
  return {
    allowed: true,
    maxGfa: cap,
    note: `Office floor area limited to ${cap.toLocaleString("en")} m² on this plot (roads: ${tier ? "ROW tier " + tier + " m" : "none qualifying"}${near ? ", rail station within 500 m" : ""}).`,
    source: "Plan art. 15(12) / 16(12) / 17(12)",
  };
}

export type RuleStatus = "applies" | "binding" | "blocked" | "info";
export interface RuleRow {
  id: string;
  group: "FAR and bonus" | "Shape of the building" | "Open space" | "Access" | "Parking" | "Use";
  label: string;
  value: string;
  detail: string;
  source: string;
  status: RuleStatus;
  /** If set, the user can switch this rule off to see what it removes. */
  toggle?: RuleId;
  /** How the rule enters the tool. */
  effect: "envelope" | "cap" | "gate" | "design";
}

const m = (x: number, d = 1) => `${x.toLocaleString("en", { maximumFractionDigits: d })} m`;
const m2 = (x: number) => `${Math.round(x).toLocaleString("en")} m²`;

export function buildRules(input: PlotInput, low: Envelope, high: Envelope, stationM: number | null): RuleRow[] {
  const p = prepare(input);
  const z = ZONES[input.zone];
  const far = farFor(input.zone, input.bonus, p.siteArea);
  const rows: RuleRow[] = [];

  rows.push({
    id: "far", group: "FAR and bonus", label: `Floor area ratio, zone ${z.label}`,
    value: `${far.baseFar} : 1 → ${m2(far.baseFar * p.siteArea)}`,
    detail: `${z.purpose}. Applies to the whole plot, even if it is later subdivided.`,
    source: z.article, status: "binding", toggle: "far-cap", effect: "cap",
  });
  rows.push({
    id: "bonus", group: "FAR and bonus", label: "FAR bonuses",
    value: far.bonusPct > 0 ? `+${(far.bonusPct * 100).toFixed(0)} % → ${far.effectiveFar.toFixed(2)} : 1` : "none selected",
    detail: far.bonusBreakdown.capped
      ? "Bonuses together are capped at 20 % of the FAR."
      : "Energy-conserving building 5-20 %, water retention 5 % per 1 m³ per 50 m² of land, affordable housing up to 20 %. All together at most 20 %.",
    source: "Plan arts. 52, 55, 56, 57", status: far.bonusPct > 0 ? "applies" : "info", effect: "cap",
  });
  rows.push({
    id: "far10", group: "FAR and bonus", label: "Hard FAR limit for high-rise / extra-large",
    value: `${MAX_FAR_HIGHRISE} : 1 → ${m2(MAX_FAR_HIGHRISE * p.siteArea)}`,
    detail: "Applies to buildings of 23 m or more, or 10,000 m² or more, whatever bonuses are earned.",
    source: "MR 33 art. 5", status: far.effectiveFar > MAX_FAR_HIGHRISE ? "binding" : "info", effect: "cap",
  });

  for (const r of input.roads) {
    const sb = roadSetbackFromBoundary(r.row);
    rows.push({
      id: `setback-${r.edge}`, group: "Shape of the building", label: `Road setback (low-rise), ROW ${m(r.row, 0)}`,
      value: sb > 0 ? m(sb, 2) : "none",
      detail: r.row < 10 ? "Narrow road: building line at least 6 m from the road centreline." : r.row <= 20 ? "Road 10-20 m wide: 1/10 of the road width from the road boundary." : "Road over 20 m wide: 2 m from the road boundary.",
      source: "MR 55 art. 41, Ord 44 art. 50", status: "applies", toggle: "road-setback", effect: "envelope",
    });
  }
  rows.push({
    id: "boundary-low", group: "Shape of the building", label: "Distance to side and rear boundaries, under 23 m",
    value: m(SIDE_LOWRISE), detail: "Walls and balconies with openings, building 9 to 23 m high.",
    source: "MR 55 art. 50", status: "applies", toggle: "boundary", effect: "envelope",
  });
  rows.push({
    id: "boundary-high", group: "Shape of the building", label: "Setback for 23 m and higher: every boundary and the road",
    value: m(SIDE_HIGHRISE), detail: "Measured from the outermost edge of the building, above and below ground, excluding foundations.",
    source: "MR 33 art. 4", status: "applies", toggle: "boundary", effect: "envelope",
  });
  for (const r of input.roads) {
    rows.push({
      id: `plane-${r.edge}`, group: "Shape of the building", label: `Height plane, road ROW ${m(r.row, 0)}`,
      value: `height ≤ 2 × (${m(r.row, 0)} + distance in from the road edge)`,
      detail: `At the plot edge ${m(2 * r.row, 0)}, gaining 2 m of height for every 1 m moved in. On a corner or between two roads the wider road governs.`,
      source: "MR 55 arts. 44-46, Ord 44 art. 49", status: "applies", toggle: "height-plane", effect: "envelope",
    });
  }
  rows.push({
    id: "levels", group: "Shape of the building", label: "Low-rise limit",
    value: `below ${HIGH_RISE_H} m (7 floors of 3.2 m), under 10,000 m²`,
    detail: "From 23 m the stricter high-rise rules apply to the whole building, including its podium. From 10,000 m² the same rules apply.",
    source: "MR 33 art. 1", status: "info", effect: "envelope",
  });

  const os = openSpaceRequired(input.zone, input.use, p.siteArea, far.effectiveFar * p.siteArea);
  rows.push({
    id: "open-space", group: "Open space", label: "Open space at full FAR",
    value: `${m2(os.required)} (${((os.required / p.siteArea) * 100).toFixed(1)} % of the plot)`,
    detail: `Larger of ${(os.landPct * 100).toFixed(0)} % of the land (${m2(os.landRequired)}) and the zone OSR ${(os.osrPct * 100).toFixed(1)} % × total floor area (${m2(os.osrRequired)}). ${os.binding === "osr" ? "The OSR binds." : "The land share binds."} At least ${m2(os.permeableMin)} of it must be planting on permeable ground.`,
    source: "MR 33 art. 6, Ord 44 art. 52, Plan arts. 15-17", status: "binding", effect: "design",
  });

  const gate = highRiseGate(p.edges, p.roads, high.gfaCap);
  rows.push({
    id: "access", group: "Access", label: "High-rise access: frontage and road",
    value: gate.ok ? "satisfied" : "not satisfied",
    detail: gate.ok ? "A plot side of 12 m or more on a public road of at least 10 m right-of-way (18 m if over 30,000 m²). Road continuity is assumed; check on site." : gate.reason!,
    source: "MR 33 art. 2", status: gate.ok ? "applies" : "blocked", effect: "gate",
  });
  rows.push({
    id: "fire-road", group: "Access", label: "Fire access road around a high-rise",
    value: `${m(FIRE_ROAD_W)} clear`, detail: "Trafficable road, free of structures, so fire engines can reach every side.",
    source: "MR 33 art. 3", status: "applies", effect: "design",
  });
  rows.push({
    id: "front-space", group: "Access", label: "Front open space for buildings over 3 storeys",
    value: `${m(FRONT_SPACE_W)} wide, along ${(FRONT_SPACE_PERIMETER_SHARE * 100).toFixed(1)} % (1/6) of the building perimeter`,
    detail: "Continuous, connected to a 6 m internal road to the public road.",
    source: "Ord 44 art. 52(6)", status: "applies", effect: "design",
  });

  rows.push({
    id: "parking", group: "Parking", label: "Car parking",
    value: "max(per-use rate, 1 per 120 m²)",
    detail: "Condo: 1 space per unit of 60 m² or more. Bays 2.40 × 5.00 m, aisle 6 m, entry 6 m wide. Counts toward floor area in this tool.",
    source: "Ord 44 arts. 83-88, MR 7 art. 3", status: "applies", effect: "design",
  });

  const tier = roadTier(p.edges, p.roads);
  const ul = useLimits(input.use, tier, stationM);
  rows.push({
    id: "use", group: "Use", label: `Use: ${input.use}`, value: Number.isFinite(ul.maxGfa) ? `up to ${m2(ul.maxGfa)}` : "allowed",
    detail: ul.note, source: ul.source, status: Number.isFinite(ul.maxGfa) || input.use === "hotel" ? "applies" : "info", effect: "gate",
  });

  // Reference the envelopes so callers see why a mode is unavailable.
  if (!low.allowed) rows.push({ id: "low-blocked", group: "Shape of the building", label: "Low-rise", value: "no buildable footprint", detail: low.reason ?? "", source: "", status: "blocked", effect: "envelope" });
  if (!high.allowed && gate.ok) rows.push({ id: "high-blocked", group: "Shape of the building", label: "High-rise", value: "not buildable", detail: high.reason ?? "", source: "", status: "blocked", effect: "envelope" });
  return rows;
}

export interface Analysis {
  low: Envelope;
  high: Envelope;
  rows: RuleRow[];
  siteArea: number;
  far: ReturnType<typeof farFor>;
  openSpace: OpenSpace;
}

export function analyze(input: PlotInput, stationM: number | null = null): Analysis {
  const p = prepare(input);
  const low = computeEnvelope(input, "low");
  const high = computeEnvelope(input, "high");
  const far = farFor(input.zone, input.bonus, p.siteArea);
  return {
    low, high, rows: buildRules(input, low, high, stationM), siteArea: p.siteArea, far,
    openSpace: openSpaceRequired(input.zone, input.use, p.siteArea, far.effectiveFar * p.siteArea),
  };
}
