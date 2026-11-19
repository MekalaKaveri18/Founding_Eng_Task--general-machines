import { describe, expect, it } from "vitest";
import { makeFrame } from "../src/geo/local";
import { PRESETS } from "../src/presets";
import { analyze } from "../src/engine/rules";
import type { PlotInput } from "../src/engine/envelope";

function toInput(id: string): PlotInput {
  const p = PRESETS.find((x) => x.id === id)!;
  const f = makeFrame(p.coords[0]);
  return {
    ring: p.coords.map(f.toXY), roads: p.roads.map((r) => ({ edge: r.edge, row: r.row })), zone: p.zone,
    use: "condo", bonus: { energyLevel: 0, waterUnits: 0, affordableArea: 0 }, disabled: [],
  };
}

describe.each(PRESETS.map((p) => p.id))("preset %s", (id) => {
  const a = analyze(toInput(id));
  it("floor areas add up in both envelopes", () => {
    for (const env of [a.low, a.high]) {
      const sum = env.slices.reduce((s, x) => s + x.area, 0);
      expect(env.geometricGfa).toBeCloseTo(sum, 6);
      if (env.slices.length) expect(env.slices[env.slices.length - 1].cumulative).toBeCloseTo(sum, 6);
    }
  });
  it("allowed floor area never exceeds FAR x site", () => {
    expect(a.low.allowedGfa).toBeLessThanOrEqual(a.far.effectiveFar * a.siteArea + 1e-6);
    expect(a.high.allowedGfa).toBeLessThanOrEqual(a.far.effectiveFar * a.siteArea + 1e-6);
  });
  it("no slice is larger than the plot, and plates never grow with height", () => {
    for (const env of [a.low, a.high]) {
      for (let i = 0; i < env.slices.length; i++) {
        expect(env.slices[i].area).toBeLessThanOrEqual(a.siteArea);
        if (i > 0) expect(env.slices[i].area).toBeLessThanOrEqual(env.slices[i - 1].area + 1e-6);
      }
    }
  });
  it("recomputes fast enough for live editing (< 50 ms)", () => {
    const input = toInput(id);
    analyze(input); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) analyze(input);
    const per = (performance.now() - t0) / 5;
    expect(per).toBeLessThan(50);
  });
});

describe("what the presets show", () => {
  it("Soi 22 (12 m soi): high-rise is allowed", () => {
    expect(analyze(toInput("soi22")).high.allowed).toBe(true);
  });
  it("the 6 m soi lot: high-rise is blocked by MR 33 art. 2, low-rise is allowed", () => {
    const a = analyze(toInput("narrow"));
    expect(a.high.allowed).toBe(false);
    expect(a.low.allowed).toBe(true);
  });
  it("the corner lot: the 30 m Sukhumvit Road governs the height plane, so it reaches higher than Soi 22 alone", () => {
    const corner = analyze(toInput("corner"));
    const soiOnly = analyze({ ...toInput("corner"), roads: [{ edge: 4, row: 12 }] });
    expect(corner.high.maxHeight).toBeGreaterThan(soiOnly.high.maxHeight);
  });
});
