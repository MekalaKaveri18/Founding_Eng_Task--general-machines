# Plot Envelope: what can I build on this Bangkok plot?

**Live tool: https://founding-eng-task-general-machines.vercel.app**

A browser tool for a Bangkok developer's first question before paying an architect: how big, how tall and what shape can a building on this plot be, given the zone's rules? Pick or draw a plot, mark the sides that face a road, choose a building type, and it shows the rules that apply, the allowed 3D envelope among the real surrounding buildings, and concept designs, each with a pass/fail checklist. Everything updates live.

**Scope:** one zone family done properly, the **Brown zone (high-density residential, ย.8 / ย.9 / ย.10)** of the Bangkok Comprehensive Plan B.E. 2556. The demo site is the Sukhumvit corridor (Asoke to Phrom Phong), with three one-click presets: Sukhumvit Soi 22, a lot on a 6 m soi, and a corner of Sukhumvit Road (30 m) and Soi 22.

## Run it

```
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest, 100+ cases
npm run build    # type-check and production build
```

Needs Node 20 or later. No API keys, no backend: it is a static site (Vite + TypeScript + MapLibre GL + Terra Draw).

Optional, to rebuild the site data (needs Python and `pip install osmium`):

```
python scripts/bake_osm.py <Bangkok.osm.pbf> public/data   # buildings, roads, stations
python scripts/make_presets.py public/data/roads.geojson src/presets.json
```

The OpenStreetMap extract comes from https://download.bbbike.org/osm/bbbike/Bangkok/. The data is baked into the repo so the app never depends on a live OSM query service.

## How to use it

1. **Plot:** use a preset, or **Draw a plot** and click the corners, then drag corners and midpoints. Everything below recomputes as you drag.
2. **Roads:** tick the sides that face a road and set each road's right-of-way (ROW, boundary to boundary). Sides and widths are guessed from OpenStreetMap, which almost never records widths, so check them.
3. **Building:** zone (ย.8, ย.9, ย.10), building type (condo, rental, office, hotel) and FAR bonuses.
4. **Read the result:** low-rise and high-rise envelope tabs; the rules list with sources; per-rule switches to see the envelope without a rule, and "show removed volume" ghosts; floor-by-floor areas.
5. **Concept designs:** pick one to see it in 3D with its checklist. **Print summary** gives a one-page PDF. The URL holds the whole scenario, so a link reproduces it.

## Rules implemented, with sources

Every rule was checked against the primary Thai legal text; sources and article numbers are in [`docs/research-notes.md`](docs/research-notes.md).

| Rule | Value | Source |
|---|---|---|
| Floor area ratio (FAR) | ย.8 6:1, ย.9 7:1, ย.10 8:1 | Plan B.E. 2556 arts. 15-17 (Royal Gazette 130/41ก, 16 May 2013) |
| Open space ratio (OSR) | ย.8 5 %, ย.9 4.5 %, ย.10 4 % of floor area; at least half of it planted on permeable ground | Plan arts. 15-17 |
| FAR bonuses | energy 5/10/15/20 %, water retention 5 % per unit, affordable housing (added area ≤ 4 × that housing); all together ≤ 20 % | Plan arts. 52, 55, 56, 57 |
| FAR cap for high-rise / extra-large | 10:1 | MR 33 art. 5 |
| Open space, residential | at least 30 % of the land | MR 33 art. 6, Ordinance art. 52(1) |
| Road setback | road < 10 m: 6 m from the centreline; 10-20 m: 1/10 of the road width; > 20 m: 2 m | MR 55 art. 41, Ordinance art. 50 |
| Distance to side and rear boundaries, under 23 m | 3 m (walls with openings, 9-23 m) | MR 55 art. 50 |
| High-rise (23 m and up) and extra-large (10,000 m² and up) | 6 m from every boundary and road, for the whole building including its podium; 6 m clear fire road all round | MR 33 arts. 1, 3, 4 |
| High-rise access | plot side of at least 12 m on a road of at least 10 m ROW; over 30,000 m² needs 18 m | MR 33 art. 2 |
| Height plane | height ≤ 2 × distance to the opposite road boundary; the wider road governs on a corner | MR 55 arts. 44-46, Ordinance art. 49 |
| Front open space (over 3 storeys) | 12 m wide, along at least 1/6 of the building perimeter | Ordinance art. 52(6) |
| Parking | max(1 per unit of 60 m² or more, 1 per 120 m² of floor area); bays 2.40 × 5.00 m, 6 m aisle | Ordinance arts. 83-88, MR 7 art. 3 as amended by MR 64 |
| Office over 1,000 m², hotel over 50 rooms | prohibited unless the road is wide enough (ROW 12/16/30 m by size) or a rail station is within 500 m | Plan arts. 15(8), 15(12), 36, 37 |

Abbreviations: **Plan** is the Ministerial Regulation enforcing the Bangkok Comprehensive Plan B.E. 2556; **MR 33** (B.E. 2535), **MR 55** (B.E. 2543, amended by MR 61, 66, 68) and **MR 7** are Building Control Act ministerial regulations; **Ordinance** is the Bangkok Building Control Ordinance B.E. 2544.

## Assumptions and limits (please read)

These are the calls where the law or the data was unclear. They are stated in the tool where they matter.

- **Plan in force:** B.E. 2556 is treated as the operative law. It was issued with a 5-year term and has been extended; a 4th revision is in draft (expected 2027).
- **Zone is an input.** No machine-readable B.E. 2556 zoning map was reachable (the BMA and Lands Department GIS servers did not respond, and no open copy exists). The demo plots' zone (ย.10) comes from property-agent listings for Sois 18, 22, 31 and 65/1, which match the Gazette's FAR and OSR for ย.10. It is not an official land-use certificate; check with a BMA land-use certificate.
- **Road width is an input.** Only 9 of 2,424 OpenStreetMap roads in the area have a width tag, so the default comes from road class and you override it. Road continuity (MR 33 art. 2) is assumed.
- **Building heights:** 26 % of OpenStreetMap buildings have a height or level count (most towers do). The rest use a fallback height (shown in a lighter grey).
- **Floor height 3.2 m**; the envelope steps in whole floors, so the sloping 2:1 plane becomes steps.
- **Parking floors count toward floor area**, at about 30 m² gross per car space. Whether basement parking counts in BMA practice was not verified.
- **Net area** is 78 % of usable gross area; average net unit 45 m² (condo), 32 m² (rental, hotel room). Units of 60 m² or more are 40 % of condo units. These are design assumptions, not legal figures.
- **Front open space (12 m)** is my reading of Ordinance art. 52(6): a 12 m strip along the road, with a 6 m internal road to the public road assumed.
- **Twin towers** keep a 6 m gap, taken from MR 55 art. 48 and applied as a minimum.
- **Terrain is ignored**: Bangkok is flat (0-2 m).
- **Scope limits:** one zone family, one corridor of data, no heritage, airport-height, flood or other overlay controls, and no structural or fire-engineering design. This is a first-pass feasibility tool, not permit advice.

## How it works

- `src/engine/` is pure TypeScript with no DOM, covered by `npm test` and hand-checked against the regulations.
  - `envelope.ts`: per-edge setbacks, boundary distances, 2:1 height plane, FAR and access gates. Two envelopes are computed: **low-rise** (under 23 m and under 10,000 m², 3 m side distances) and **high-rise** (6 m everywhere).
  - `designs.ts`: concept designs. Plates are rectangles aligned to the frontage edge, cut by each floor's allowable slice, with ground coverage trimmed to leave the required open space and the fewest parking podium floors that meet the parking rule. The checklist re-verifies setbacks and the height plane with plain distance arithmetic, independent of the geometry that built the plates.
  - `rules.ts`, `parking.ts`, `constants.ts`: the rule list, open space, parking and every number with its source.
- **clipper2-js is used for booleans and areas only.** Two bugs in v1.2.4 shaped the code: its `InflatePaths` (offset) applies half the requested distance and returns malformed polygons, so per-edge setbacks are explicit strip polygons subtracted with clipper; and its boolean operations **modify their input paths**, so every operation in `geom.ts` works on private copies. Tests document both (`tests/clipper-smoke.test.ts`, `tests/immutability.test.ts`).
- The 3D uses MapLibre `fill-extrusion` only. Envelope blocks, rule ghosts (kept 5 cm from the envelope) and concept designs are separate layers, and a selected design replaces the envelope volume, so no two surfaces share a face.
- The default Vitest worker pools fail on this Windows + Node 24 setup, so `vitest.config.ts` uses `vmThreads`.

## Repository

- `docs/research-notes.md`: the legal research, article by article, with what was verified and what was not.
- `docs/build-plan.md`: the plan this was built to.
- `scripts/`: data baking and preset generation.
- `tests/`: 100+ Vitest cases, including hand-worked examples.
