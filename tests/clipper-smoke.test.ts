import { describe, expect, it } from "vitest";
import { Clipper, EndType, FillRule, JoinType, Path64, Paths64, Point64 } from "clipper2-js";

const sq = (s: number) => {
  const p = new Path64();
  for (const [x, y] of [[0, 0], [s, 0], [s, s], [0, s]]) p.push(new Point64(x, y));
  return p;
};
const wrap = (...ps: Path64[]) => { const r = new Paths64(); ps.forEach((p) => r.push(p)); return r; };

describe("clipper2-js behaviour we rely on", () => {
  it("difference of squares gives the L-shape area", () => {
    const out = Clipper.Difference(wrap(sq(10000)), wrap(sq(5000)), FillRule.NonZero);
    expect(Math.abs(Clipper.areaPaths(out))).toBe(75_000_000);
  });
  // KNOWN BUG in clipper2-js 1.2.4: InflatePaths applies half the requested distance and returns malformed
  // vertices for closed polygons. These are marked `fails`: if a future version fixes it, they start
  // "passing unexpectedly" and tell us it is safe to reconsider. The engine does NOT use InflatePaths.
  it.fails("butt-ended open path inflates to a rectangle", () => {
    const seg = new Path64(); seg.push(new Point64(0, 0)); seg.push(new Point64(10000, 0));
    const out = Clipper.InflatePaths(wrap(seg), 2000, JoinType.Round, EndType.Butt);
    expect(Math.abs(Clipper.areaPaths(out))).toBe(10000 * 4000);
  });
  it.fails("closed polygon inflates inward with a negative delta", () => {
    const out = Clipper.InflatePaths(wrap(sq(10000)), -1000, JoinType.Miter, EndType.Polygon);
    expect(Math.abs(Clipper.areaPaths(out))).toBe(8000 * 8000);
  });
});
