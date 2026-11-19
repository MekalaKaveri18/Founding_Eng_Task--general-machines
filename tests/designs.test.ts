import { describe, expect, it } from "vitest";
import type { XY } from "../src/geo/local";
import { designSchemes } from "../src/engine/designs";
import { analyze } from "../src/engine/rules";
import { regionArea } from "../src/engine/geom";
import { prepare, type PlotInput } from "../src/engine/envelope";
import { makeFrame } from "../src/geo/local";
import { PRESETS } from "../src/presets";

const RECT: XY[] = [[0, 0], [30, 0], [30, 40], [0, 40]];
const base = (over: Partial<PlotInput> = {}): PlotInput => ({
  ring: RECT, roads: [{ edge: 0, row: 12 }], zone: "Y10", use: "condo",
  bonus: { energyLevel: 0, waterUnits: 0, affordableArea: 0 }, disabled: [], ...over,
});
const get = (input: PlotInput, kind: string) => {
  const a = analyze(input);
  return { a, s: designSchemes(input, a).find((x) => x.kind === kind)! };
};

describe("low-rise block on a 30 x 40 m plot, 12 m road (hand-worked)", () => {
  // Footprint x 3..27, y 1.2..37. Condo, 12 m front open space -> plate x 3..27, y 12..37 = 24 x 25 = 600 m2.
  // Open space needed 30 % of 1200 = 360, so a 600 m2 plate fits (max cover 840).
  // P=1: 20 cars < ceil(3600/120) = 30 needed. P=2: 40 cars >= max(units60 = 20, ceil(3000/120) = 25).
  const { s } = get(base(), "block");
  it("uses a 600 m2 plate on all 7 floors", () => {
    expect(s.feasible).toBe(true);
    expect(s.floors.length).toBe(7);
    for (const f of s.floors) expect(f.area).toBeCloseTo(600, 1);
    expect(s.groundCoverage).toBeCloseTo(600, 1);
    expect(s.gfa).toBeCloseTo(4200, 1);
  });
  it("needs 2 parking floors: 40 spaces for 25 required", () => {
    expect(s.podiumFloors).toBe(2);
    expect(s.parkingProvided).toBe(40);
    expect(s.parkingRequired).toBe(25);
  });
  it("has 52 units: 5 residential floors x 600 m2 x 0.78 / 45 m2", () => {
    expect(s.units).toBe(52);
  });
  it("passes every applicable check", () => {
    expect(s.passes).toBe(true);
    const front = s.checks.find((c) => c.id === "front-space")!;
    expect(front.pass).toBe(true);
    expect(front.value).toMatch(/^30\.0 m/); // the whole 30 m frontage is clear of the building within 12 m
  });
  it("floor areas add up: cumulative equals the running sum and the total", () => {
    let sum = 0;
    for (const f of s.floors) {
      expect(f.parts.reduce((a, p) => a + p.area, 0)).toBeCloseTo(f.area, 6);
      sum += f.area;
      expect(f.cumulative).toBeCloseTo(sum, 6);
    }
    expect(sum).toBeCloseTo(s.gfa, 6);
  });
});

describe("every design respects the rules it claims to", () => {
  const input = base();
  const a = analyze(input);
  const schemes = designSchemes(input, a).filter((s) => s.feasible);
  it("generates the high-rise designs and the low-rise block", () => {
    expect(schemes.map((s) => s.kind).sort()).toEqual(["block", "slab", "tower"].sort());
  });
  it("floor area never exceeds the cap and plates stay inside the envelope", () => {
    for (const s of schemes) {
      const env = a[s.mode];
      expect(s.gfa).toBeLessThanOrEqual(env.gfaCap + 1e-6);
      for (const f of s.floors) {
        const slice = env.slices[f.floor - 1];
        for (const p of f.parts) expect(regionArea(p.region)).toBeLessThanOrEqual(regionArea(slice.region) + 1e-6);
      }
    }
  });
  it("ground coverage leaves the required open space", () => {
    for (const s of schemes) expect(regionArea(prepare(input).site) - s.groundCoverage).toBeGreaterThan(0.3 * 1200 - 1e-6);
  });
  it("a high-rise design really is 23 m or taller; a low-rise design is not", () => {
    for (const s of schemes) {
      if (s.mode === "high") expect(s.height).toBeGreaterThanOrEqual(23);
      else expect(s.height).toBeLessThan(23);
    }
  });
});

describe("twin towers", () => {
  it("are infeasible on a plot too narrow for two towers and a 6 m gap", () => {
    const input = base();
    const a = analyze(input);
    const s = designSchemes(input, a).find((x) => x.kind === "twin");
    expect(s?.feasible).toBe(false);
    expect(s?.reason).toMatch(/too narrow/);
  });
  it("keep a 6 m gap on a wide plot", () => {
    const wide: XY[] = [[0, 0], [90, 0], [90, 60], [0, 60]];
    const input = base({ ring: wide, roads: [{ edge: 0, row: 16 }] });
    const a = analyze(input);
    const s = designSchemes(input, a).find((x) => x.kind === "twin")!;
    expect(s.feasible).toBe(true);
    expect(s.checks.find((c) => c.id === "spacing")!.pass).toBe(true);
  });
});

describe("narrow 6 m soi: only low-rise designs, and two of them", () => {
  const p = PRESETS.find((x) => x.id === "narrow")!;
  const f = makeFrame(p.coords[0]);
  const input: PlotInput = { ring: p.coords.map(f.toXY), roads: p.roads.map((r) => ({ edge: r.edge, row: r.row })), zone: p.zone, use: "condo", bonus: { energyLevel: 0, waterUnits: 0, affordableArea: 0 }, disabled: [] };
  const a = analyze(input);
  const out = designSchemes(input, a);
  it("offers a block and a garden block", () => {
    expect(out.map((s) => s.kind)).toEqual(["block", "garden"]);
    expect(out.every((s) => s.mode === "low")).toBe(true);
  });
  it("the garden block covers at most 60 % of the block's ground and has clearly less floor area", () => {
    const [block, garden] = out;
    expect(garden.groundCoverage).toBeLessThanOrEqual(0.6 * block.groundCoverage + 0.5);
    expect(garden.gfa).toBeLessThan(0.75 * block.gfa);
    expect(garden.passes).toBe(true);
  });
});

describe("presets: at least two designs fit on every preset", () => {
  for (const p of PRESETS) {
    it(p.id, () => {
      const f = makeFrame(p.coords[0]);
      const input: PlotInput = { ring: p.coords.map(f.toXY), roads: p.roads.map((r) => ({ edge: r.edge, row: r.row })), zone: p.zone, use: "condo", bonus: { energyLevel: 0, waterUnits: 0, affordableArea: 0 }, disabled: [] };
      const out = designSchemes(input, analyze(input));
      const fitting = out.filter((s) => s.feasible && s.passes);
      expect(fitting.length, `${p.id}: ${out.map((s) => `${s.kind}:${s.feasible ? (s.passes ? "pass" : "FAIL " + s.checks.filter((c) => c.pass === false).map((c) => c.id)) : "n/a"}`).join(" ")}`).toBeGreaterThanOrEqual(2);
    });
  }
});
