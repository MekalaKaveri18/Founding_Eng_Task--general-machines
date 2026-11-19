import { describe, expect, it } from "vitest";
import type { XY } from "../src/geo/local";
import { roadSetbackFromBoundary } from "../src/engine/constants";
import {
  computeEnvelope, farFor, ghostFor, highRiseGate, prepare, type Bonus, type PlotInput,
} from "../src/engine/envelope";
import { isSelfIntersecting, regionArea } from "../src/engine/geom";

const NO_BONUS: Bonus = { energyLevel: 0, waterUnits: 0, affordableArea: 0 };

// 30 m x 40 m plot, CCW. Edge 0 is the south edge (0,0)->(30,0), 30 m long.
const RECT: XY[] = [[0, 0], [30, 0], [30, 40], [0, 40]];

const base = (over: Partial<PlotInput> = {}): PlotInput => ({
  ring: RECT, roads: [{ edge: 0, row: 12 }], zone: "Y10", use: "condo", bonus: NO_BONUS, disabled: [], ...over,
});

describe("road setback rule (MR 55 art. 41 / Ord 44 art. 50)", () => {
  it.each([
    [6, 3], // 6 m from centreline, road 6 m wide: 3 m from the boundary
    [8, 2],
    [9.9, 6 - 9.9 / 2],
    [10, 1], // 1/10 of the road width
    [12, 1.2],
    [20, 2],
    [30, 2],
    [40, 2],
  ])("ROW %d m -> %d m from the road boundary", (row, expected) => {
    expect(roadSetbackFromBoundary(row)).toBeCloseTo(expected, 9);
  });
});

describe("FAR and bonuses (Plan arts. 15-17, 52, 55, 56, 57)", () => {
  it("base FAR by zone", () => {
    expect(farFor("Y8", NO_BONUS, 1000).effectiveFar).toBe(6);
    expect(farFor("Y9", NO_BONUS, 1000).effectiveFar).toBe(7);
    expect(farFor("Y10", NO_BONUS, 1000).effectiveFar).toBe(8);
  });
  it("energy level 4 gives +20 % -> 9.6 in Y10", () => {
    expect(farFor("Y10", { ...NO_BONUS, energyLevel: 4 }, 1000).effectiveFar).toBeCloseTo(9.6, 9);
  });
  it("bonuses add up and are capped at 20 % in total (art. 57)", () => {
    const r = farFor("Y10", { energyLevel: 4, waterUnits: 2, affordableArea: 0 }, 1000);
    expect(r.bonusPct).toBeCloseTo(0.2, 9);
    expect(r.bonusBreakdown.capped).toBe(true);
    expect(r.effectiveFar).toBeCloseTo(9.6, 9);
  });
  it("partial bonuses add: energy level 1 (5 %) + water 1 unit (5 %) = 10 %", () => {
    expect(farFor("Y9", { energyLevel: 1, waterUnits: 1, affordableArea: 0 }, 1000).effectiveFar).toBeCloseTo(7.7, 9);
  });
  it("affordable housing: added area <= 4 x that housing, and <= 20 % (art. 52)", () => {
    // base GFA 8 x 1000 = 8000. 100 m2 of affordable housing -> +400 m2 = 5 %.
    expect(farFor("Y10", { ...NO_BONUS, affordableArea: 100 }, 1000).bonusPct).toBeCloseTo(0.05, 9);
    expect(farFor("Y10", { ...NO_BONUS, affordableArea: 5000 }, 1000).bonusPct).toBeCloseTo(0.2, 9);
  });
});

describe("low-rise envelope on a 30 x 40 m plot, road 12 m on the south edge", () => {
  const env = computeEnvelope(base(), "low");
  it("footprint = (30 - 3 - 3) x (40 - 1.2 - 3) = 24 x 35.8 = 859.2 m2", () => {
    expect(regionArea(env.footprint)).toBeCloseTo(859.2, 1);
  });
  it("is capped at 7 floors: 8 x 3.2 = 25.6 m would be a high-rise (>= 23 m)", () => {
    expect(env.slices.length).toBe(7);
    expect(env.maxHeight).toBeCloseTo(22.4, 9);
  });
  it("the 2:1 plane does not touch a 22.4 m building next to a 12 m road (needs z > 24 m)", () => {
    for (const s of env.slices) expect(s.area).toBeCloseTo(859.2, 1);
  });
  it("geometric GFA is 7 x 859.2 and below the FAR cap of 8 x 1200", () => {
    expect(env.geometricGfa).toBeCloseTo(7 * 859.2, 0);
    expect(env.allowedGfa).toBeCloseTo(env.geometricGfa, 6);
    expect(env.gfaCap).toBeCloseTo(9600, 6);
  });
  it("floor areas add up: cumulative equals the running sum of slice areas", () => {
    let sum = 0;
    for (const s of env.slices) {
      sum += s.area;
      expect(s.cumulative).toBeCloseTo(sum, 6);
    }
  });
});

describe("high-rise envelope on the same plot (MR 33: 6 m from every boundary and the road)", () => {
  const env = computeEnvelope(base(), "high");
  it("footprint = 18 x 28 = 504 m2", () => {
    expect(regionArea(env.footprint)).toBeCloseTo(504, 1);
  });
  it("floors up to 35.2 m are untouched by the height plane (plane depth z/2 - 12 stays <= 6 m)", () => {
    for (const s of env.slices.filter((x) => x.zTop <= 35.2 + 1e-9)) expect(s.area).toBeCloseTo(504, 1);
  });
  it("floor 12 (38.4 m): plane depth 7.2 m > 6 m setback -> area 18 x (34 - 7.2) = 482.4", () => {
    expect(env.slices[11].area).toBeCloseTo(482.4, 1);
  });
  it("floor 27 (86.4 m) is the last usable floor (area 18 x 2.8 = 50.4); floor 28 would be 21.6 m2 < 30", () => {
    expect(env.slices.length).toBe(27);
    expect(env.slices[26].area).toBeCloseTo(50.4, 1);
    expect(env.maxHeight).toBeCloseTo(86.4, 9);
  });
  it("is capped by FAR 8 x 1200 = 9600 m2 (below the 10:1 limit of 12,000)", () => {
    expect(env.gfaCap).toBeCloseTo(9600, 6);
    expect(env.capFloor).toBeGreaterThan(0);
    const last = env.slices[env.capFloor - 1];
    expect(last.cumulative).toBeLessThanOrEqual(9600 + 1e-6);
    const next = env.slices[env.capFloor];
    if (next) expect(next.cumulative).toBeGreaterThan(9600);
  });
});

describe("rule toggles change the envelope", () => {
  it("switching off the road setback adds the 1.2 m strip back (low-rise)", () => {
    const off = computeEnvelope(base({ disabled: ["road-setback"] }), "low");
    expect(regionArea(off.footprint)).toBeCloseTo(24 * 37, 1); // 3 m sides + rear, no front setback
  });
  it("switching off the boundary rule widens the footprint to the plot minus the road setback", () => {
    const off = computeEnvelope(base({ disabled: ["boundary"] }), "low");
    expect(regionArea(off.footprint)).toBeCloseTo(30 * 38.8, 1);
  });
  it("switching off the height plane lets a high-rise keep its full plate", () => {
    const off = computeEnvelope(base({ disabled: ["height-plane"] }), "high");
    expect(off.slices.length).toBeGreaterThan(27);
    expect(off.slices[26].area).toBeCloseTo(504, 1);
  });
  it("switching off the zone FAR leaves only the separate MR 33 art. 5 limit of 10:1 (12,000 m2)", () => {
    const off = computeEnvelope(base({ disabled: ["far-cap"] }), "high");
    expect(off.gfaCap).toBeCloseTo(12000, 6);
    const lowOff = computeEnvelope(base({ disabled: ["far-cap"] }), "low");
    expect(lowOff.gfaCap).toBe(9999); // 10,000 m2 would make it an extra-large building (MR 33 art. 1)
  });
  it("ghost volume of the height plane is the removed wedge, and the ghost areas are non-trivial", () => {
    const g = ghostFor(base(), "high", "height-plane");
    expect(g.length).toBeGreaterThan(0);
    // floor 12 loses 18 x 1.2 = 21.6 m2 compared with the full 504 m2 plate
    const f12 = g.find((x) => x.floor === 12)!;
    expect(f12).toBeDefined();
    const area = f12.polys.reduce((s, poly) => {
      const ring = poly[0];
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        a += x1 * y2 - x2 * y1;
      }
      return s + Math.abs(a / 2);
    }, 0);
    expect(area).toBeCloseTo(21.6, 1);
  });
});

describe("concave plots follow the real outline", () => {
  // L-shape, 1200 m2. South edge (0,0)->(40,0) is the road, ROW 12.
  const L: XY[] = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]];
  it("low-rise footprint matches the hand computation 537.2 + 280 + 1.93 m2", () => {
    const env = computeEnvelope(base({ ring: L }), "low");
    // A: x 3..37, y 1.2..17 = 537.2. B: x 3..17, y 17..37 = 280. Corner remnant at the reflex vertex = 9 - pi*9/4.
    expect(regionArea(env.footprint)).toBeCloseTo(537.2 + 280 + (9 - (Math.PI * 9) / 4), 0);
  });
  it("the footprint is strictly smaller than the bounding-box result", () => {
    const env = computeEnvelope(base({ ring: L }), "low");
    expect(regionArea(env.footprint)).toBeLessThan((40 - 6) * (40 - 4.2));
  });
});

describe("input handling", () => {
  it("accepts a clockwise ring and remaps the frontage edge", () => {
    const cw: XY[] = [[0, 0], [0, 40], [30, 40], [30, 0]]; // CW; edge 3 = (30,0)->(0,0), the south edge
    const env = computeEnvelope(base({ ring: cw, roads: [{ edge: 3, row: 12 }] }), "low");
    expect(regionArea(env.footprint)).toBeCloseTo(859.2, 1);
    expect(prepare(base({ ring: cw, roads: [{ edge: 3, row: 12 }] })).roads[0].edge).toBe(3);
  });
  it("detects a self-intersecting (bow-tie) outline", () => {
    expect(isSelfIntersecting([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(true);
    expect(isSelfIntersecting(RECT)).toBe(false);
  });
  it("a tiny plot leaves no buildable footprint", () => {
    const tiny: XY[] = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const env = computeEnvelope(base({ ring: tiny, roads: [{ edge: 0, row: 12 }] }), "low");
    expect(env.allowed).toBe(false);
    expect(env.reason).toMatch(/no buildable footprint/i);
  });
});

describe("high-rise access gate (MR 33 art. 2)", () => {
  it("fails when no frontage is at least 12 m long", () => {
    const narrow: XY[] = [[0, 0], [10, 0], [10, 60], [0, 60]];
    const env = computeEnvelope(base({ ring: narrow }), "high");
    expect(env.allowed).toBe(false);
    expect(env.reason).toMatch(/MR 33 art\. 2/);
  });
  it("fails when the road is narrower than 10 m", () => {
    const env = computeEnvelope(base({ roads: [{ edge: 0, row: 8 }] }), "high");
    expect(env.allowed).toBe(false);
  });
  it("needs an 18 m road when the building would exceed 30,000 m2", () => {
    const p = prepare(base());
    expect(highRiseGate(p.edges, p.roads, 20_000).ok).toBe(true);
    expect(highRiseGate(p.edges, p.roads, 40_000).ok).toBe(false);
  });
});

describe("corner lot: the wider road governs height (MR 55 art. 46)", () => {
  // South edge (edge 0) on a 30 m road, east edge (edge 1) on a 12 m soi.
  const env = computeEnvelope(base({ roads: [{ edge: 0, row: 30 }, { edge: 1, row: 12 }] }), "high");
  it("the 12 m soi's own plane (z/2 - 12) would cut floor 12; the 30 m road's plane (z/2 - 30) does not", () => {
    expect(env.slices[11].area).toBeCloseTo(504, 1);
  });
  it("the plane only starts to bite above 72 m (z/2 - 30 > 6)", () => {
    expect(env.slices.length).toBeGreaterThan(24);
    expect(env.slices[21].area).toBeCloseTo(504, 1); // floor 22 = 70.4 m
    expect(env.slices[22].area).toBeLessThan(504); // floor 23 = 73.6 m
  });
});
