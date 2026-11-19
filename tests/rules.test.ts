import { describe, expect, it } from "vitest";
import type { XY } from "../src/geo/local";
import { hotelSpaces, parkingArea, parkingRequired } from "../src/engine/parking";
import { analyze, openSpaceRequired, roadTier, useLimits } from "../src/engine/rules";
import { prepare, type PlotInput } from "../src/engine/envelope";

const RECT: XY[] = [[0, 0], [30, 0], [30, 40], [0, 40]];
const input = (over: Partial<PlotInput> = {}): PlotInput => ({
  ring: RECT, roads: [{ edge: 0, row: 12 }], zone: "Y10", use: "condo",
  bonus: { energyLevel: 0, waterUnits: 0, affordableArea: 0 }, disabled: [], ...over,
});

describe("open space: the larger of the land share and OSR x floor area", () => {
  it("Y10 at full FAR: OSR 4 % x 8 = 32 % of the site beats the 30 % land share", () => {
    const r = openSpaceRequired("Y10", "condo", 1000, 8000);
    expect(r.landRequired).toBeCloseTo(300, 9);
    expect(r.osrRequired).toBeCloseTo(320, 9);
    expect(r.required).toBeCloseTo(320, 9);
    expect(r.binding).toBe("osr");
    expect(r.permeableMin).toBeCloseTo(160, 9);
    expect(r.maxCoverage).toBeCloseTo(680, 9);
  });
  it("Y9: 4.5 % x 7 = 31.5 % binds", () => {
    expect(openSpaceRequired("Y9", "condo", 1000, 7000).required).toBeCloseTo(315, 9);
  });
  it("Y8: 5 % x 6 = 30 %: equal to the land share, land share is reported as binding", () => {
    const r = openSpaceRequired("Y8", "condo", 1000, 6000);
    expect(r.required).toBeCloseTo(300, 9);
    expect(r.binding).toBe("land");
  });
  it("Y10 with the full 20 % bonus: 4 % x 9.6 = 38.4 % of the site", () => {
    expect(openSpaceRequired("Y10", "condo", 1000, 9600).required).toBeCloseTo(384, 9);
  });
  it("non-residential use only needs 10 % of the land (MR 33 art. 6(2))", () => {
    expect(openSpaceRequired("Y10", "office", 1000, 2000).landRequired).toBeCloseTo(100, 9);
  });
});

describe("parking (Ord 44 arts. 83-88, MR 7)", () => {
  it("condo: max(units of 60 m2+, ceil(GFA/120))", () => {
    // 6,000 m2 of floor area -> 50 spaces by area; 40 units -> 40 spaces; the area rule governs.
    expect(parkingRequired({ use: "condo", gfaExParking: 6000, units60: 40, rooms: 0 }).required).toBe(50);
    // 6,000 m2 and 80 units -> 80 spaces; the per-unit rate governs.
    expect(parkingRequired({ use: "condo", gfaExParking: 6000, units60: 80, rooms: 0 }).required).toBe(80);
  });
  it("rounds up partial spaces", () => {
    expect(parkingRequired({ use: "condo", gfaExParking: 121, units60: 0, rooms: 0 }).required).toBe(2);
    expect(parkingRequired({ use: "condo", gfaExParking: 120, units60: 0, rooms: 0 }).required).toBe(1);
  });
  it("office: 1 per 60 m2", () => {
    expect(parkingRequired({ use: "office", gfaExParking: 3000, units60: 0, rooms: 0 }).required).toBe(50);
  });
  it("hotel rates by rooms: 10 for the first 30, then 1 per 5 rooms up to 100, then 1 per 10", () => {
    expect(hotelSpaces(20)).toBe(10);
    expect(hotelSpaces(30)).toBe(10);
    expect(hotelSpaces(100)).toBe(10 + 14); // 70 rooms / 5
    expect(hotelSpaces(150)).toBe(10 + 14 + 5); // 50 rooms / 10
  });
  it("parking area uses ~30 m2 per space", () => {
    expect(parkingArea(50)).toBe(1500);
  });
});

describe("use restrictions in ย.8-ย.10 (Plan arts. 15(8), 15(12))", () => {
  it("residential is unrestricted", () => {
    expect(useLimits("condo", 0, null).maxGfa).toBe(Infinity);
  });
  it("offices: 1,000 m2 by default; 2,000 with a 12 m road; 5,000 with 16 m; 10,000 with 30 m", () => {
    expect(useLimits("office", 0, null).maxGfa).toBe(1000);
    expect(useLimits("office", 12, null).maxGfa).toBe(2000);
    expect(useLimits("office", 16, null).maxGfa).toBe(5000);
    expect(useLimits("office", 30, null).maxGfa).toBe(10000);
  });
  it("a rail station within 500 m lifts the office limit to 10,000 m2", () => {
    expect(useLimits("office", 0, 450).maxGfa).toBe(10000);
    expect(useLimits("office", 0, 520).maxGfa).toBe(1000);
  });
  it("road tier needs both the right-of-way and a long enough plot side", () => {
    const p = prepare(input());
    expect(roadTier(p.edges, [{ edge: 0, row: 30 }])).toBe(30); // south edge is 30 m long
    expect(roadTier(p.edges, [{ edge: 0, row: 16 }])).toBe(16);
    expect(roadTier(p.edges, [{ edge: 0, row: 12 }])).toBe(12);
    expect(roadTier(p.edges, [{ edge: 1, row: 30 }])).toBe(30); // the east edge is 40 m long
    expect(roadTier(p.edges, [{ edge: 0, row: 8 }])).toBe(0);
  });
});

describe("analysis end to end", () => {
  it("produces both envelopes and a rule list that cites sources", () => {
    const a = analyze(input());
    expect(a.low.allowed).toBe(true);
    expect(a.high.allowed).toBe(true);
    expect(a.siteArea).toBeCloseTo(1200, 6);
    expect(a.rows.length).toBeGreaterThan(10);
    for (const r of a.rows.filter((x) => x.id !== "low-blocked" && x.id !== "high-blocked")) {
      expect(r.source.length).toBeGreaterThan(0);
    }
    expect(a.openSpace.binding).toBe("osr");
  });
  it("narrow 6 m soi: the access gate blocks high-rise and the row says so", () => {
    const a = analyze(input({ roads: [{ edge: 0, row: 6 }] }));
    expect(a.high.allowed).toBe(false);
    const row = a.rows.find((r) => r.id === "access")!;
    expect(row.status).toBe("blocked");
    expect(row.value).toBe("not satisfied");
  });
  it("lists one setback row and one height-plane row per frontage", () => {
    const a = analyze(input({ roads: [{ edge: 0, row: 30 }, { edge: 1, row: 12 }] }));
    expect(a.rows.filter((r) => r.id.startsWith("setback-")).length).toBe(2);
    expect(a.rows.filter((r) => r.id.startsWith("plane-")).length).toBe(2);
  });
  it("every shaping rule can be toggled", () => {
    const a = analyze(input());
    const toggles = new Set(a.rows.filter((r) => r.toggle).map((r) => r.toggle));
    expect(toggles).toEqual(new Set(["far-cap", "road-setback", "boundary", "height-plane"]));
  });
});
