# Plot Envelope: what can I build on this Bangkok plot?

A browser tool for a Bangkok developer's first question before paying an architect: how big, how tall and what shape can a building on this plot be, given the zone's rules?

Scope: the **Brown zone (high-density residential, ย.8 / ย.9 / ย.10)** under the Bangkok Comprehensive Plan B.E. 2556, with Ministerial Regulations 33 and 55 and the Bangkok Building Control Ordinance B.E. 2544.

Status: work in progress. Site context, presets and the 3D scene are done. The rules engine, envelope and concept designs are next.

## Run

```
npm install
npm run dev
npm test
npm run build
```

## Data

`public/data/` is pre-baked from an OpenStreetMap extract by `scripts/bake_osm.py` so the app never depends on a live OSM query service. Run `python scripts/bake_osm.py <Bangkok.osm.pbf> public/data` to regenerate. Preset plots come from `scripts/make_presets.py`.

Research and sources for every rule: see `docs/research-notes.md`; build plan in `docs/build-plan.md`.

## Engine notes

- `src/engine/` is pure TypeScript with no DOM, covered by `npm test` (72 tests, hand-checked against the regulations).
- **clipper2-js is used for booleans and areas only.** Its `InflatePaths` (offset) in v1.2.4 applies half the requested distance and returns malformed polygons, so per-edge setbacks are built as explicit strip polygons (`geom.ts`) and subtracted with clipper. Two `it.fails` tests in `tests/clipper-smoke.test.ts` document the bug and will flag a fixed release.
- Two envelopes are computed: **low-rise** (under 23 m and under 10,000 m², 3 m side distances) and **high-rise** (6 m from every boundary and the road for the whole building including its podium, MR 33 art. 4).
- The default Vitest worker pools fail on this Windows + Node 24 setup, so `vitest.config.ts` uses `vmThreads`.
