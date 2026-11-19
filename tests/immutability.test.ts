import { describe, expect, it } from "vitest";
import { makeFrame, type XY } from "../src/geo/local";
import { PRESETS } from "../src/presets";
import { analyze } from "../src/engine/rules";
import { designSchemes } from "../src/engine/designs";
import { cloneRegion, difference, intersect, regionFromRing, regionToPolygons, unionAll } from "../src/engine/geom";

const snap = (r: ReturnType<typeof regionFromRing>) => JSON.stringify(regionToPolygons(r));

// clipper2-js mutates the points of the paths it is given. These tests guard the copies in geom.ts.
describe("region operations never change their inputs", () => {
  // Slanted edges force clipper to compute intersection points, which is where it used to write back.
  const a = regionFromRing([[0, 0], [50, 3], [60, 41], [-8, 40], [-6, 20]] as XY[]);
  const b = regionFromRing([[10, 5], [70, 8], [65, 30], [12, 28]] as XY[]);
  const c = regionFromRing([[-20, 10], [30, 12], [28, 25], [-18, 24]] as XY[]);
  it("difference", () => {
    const [sa, sb] = [snap(a), snap(b)];
    difference(a, b);
    expect([snap(a), snap(b)]).toEqual([sa, sb]);
  });
  it("intersect", () => {
    const [sa, sb] = [snap(a), snap(b)];
    intersect(a, b);
    expect([snap(a), snap(b)]).toEqual([sa, sb]);
  });
  it("union", () => {
    const [sa, sb, sc] = [snap(a), snap(b), snap(c)];
    unionAll([a, b, c]);
    expect([snap(a), snap(b), snap(c)]).toEqual([sa, sb, sc]);
  });
  it("results are independent copies: editing one never changes another", () => {
    const r1 = intersect(a, b);
    const r2 = cloneRegion(r1);
    const before = snap(r2);
    difference(r1, c);
    intersect(r1, c);
    expect(snap(r2)).toBe(before);
  });
  it("many reuses of one region give the same answer every time", () => {
    const first = snap(intersect(a, b));
    for (let i = 0; i < 25; i++) {
      difference(a, c);
      intersect(a, c);
    }
    expect(snap(intersect(a, b))).toBe(first);
  });
});

describe("designs leave the envelope untouched and stay inside it", () => {
  const p = PRESETS.find((x) => x.id === "soi22")!;
  const f = makeFrame(p.coords[0]);
  const input = {
    ring: p.coords.map(f.toXY), roads: p.roads.map((r) => ({ edge: r.edge, row: r.row })), zone: "Y8" as const, use: "condo" as const,
    bonus: { energyLevel: 4 as const, waterUnits: 4, affordableArea: 5000 }, disabled: [] as never[],
  };
  const a = analyze(input);
  const before = a.high.slices.map((s) => snap(s.region));
  const out = designSchemes(input, a);
  it("designSchemes does not modify any envelope slice or the footprint", () => {
    expect(a.high.slices.map((s) => snap(s.region))).toEqual(before);
  });
  it("every design passes the envelope check, including with the maximum bonus in zone ย.8", () => {
    for (const s of out.filter((x) => x.feasible)) {
      expect(s.checks.find((c) => c.id === "envelope")!.pass, `${s.kind}`).toBe(true);
    }
  });
});
