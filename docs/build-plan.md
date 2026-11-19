# Build plan: Bangkok Brown-zone massing tool

**Approved 2026-11-19, with four adjustments (these override anything below):**
1. **Presets.** On page open, a default plot on **Sukhumvit Soi 22** loads and computes immediately. Two more one-click presets: a **narrow 6 m soi lot** and a **30 m main-road corner lot**. Drawing your own plot is optional.
2. **Geometry.** Use **clipper2-js** for the inward edge offsets and the half-plane clipping. Concept plates are aligned to the **frontage edge orientation**, intersected with the allowable floor slice. No exact inscribed-rectangle solver.
3. **No z-fighting.** The Envelope and the Rule Ghosts are kept separate from the Concept Schemes: they are never shown in the same place at the same time, and where they must coexist the scheme is offset by 0.05 m, so `fill-extrusion` faces never coincide.
4. **Repo and hosting.** Code goes to https://github.com/MekalaKaveri18/Founding_Eng_Task--general-machines and deploys on Vercel. **Commits are authored by MekalaKaveri18 only**: no co-author trailers.

Deadline: **2026-11-21 07:54 UTC** (13:24 IST). Rules and data sources: [research-notes.md](research-notes.md).

## 1. Rubric to feature map

Every brief requirement, the feature that satisfies it, and how we prove it.

| Brief says | Feature | Proof (what a reviewer sees / what we test) |
|---|---|---|
| Input: the plot | Draw/edit a polygon on the map (any shape, concave OK). Drag vertices. | Draw an L-shape and a 7-sided lot. |
| Input: location / zone | Zone picker ย.8 / ย.9 / ย.10, defaulting to ย.10 for the demo site, with the listing evidence shown. Transit 500 m check computed from real station locations. | Switch zone; FAR/OSR and allowed uses change. |
| Input: road it faces | Click one or two plot edges to mark them as road frontage. Right-of-way width per road (default from OSM road class, user overrides). | Change ROW 8 m to 12 m to 30 m; setback and height plane move. |
| Input: building type | Condominium, Rental apartment, Office, Hotel. Changes parking rates, open-space %, and the allowed-use tests (size limits tied to road width / transit). | Switch to Hotel on a 10 m soi; checklist shows the plan art. 15 restriction. |
| Output: rules that apply | Rules panel: every rule with its value for THIS plot, the source article, and a pass/fail or "binding" tag. | Each row cites e.g. "MR 55 art. 44". |
| Output: allowed space | 3D envelope = stacked floor slices that follow the real outline, clipped by setbacks and the 2:1 height plane, capped by FAR. | Envelope visibly hugs the polygon; slope steps back from the road. |
| Output: >= 2 designs, each with pass/fail | Three generated schemes: **Tower + podium**, **Slab (bar)**, **Twin towers**. Each has a checklist of every rule with value vs limit. | All three render; at least two pass on the demo site. |
| Any plot shape | Geometry in local metres with a polygon-clipping library; per-edge setbacks via edge buffers subtracted from the plot. | Unit tests on concave plots. |
| Accurate: follows the outline | Same as above. No bounding-box shortcuts. | Visual plus tests. |
| Accurate: each rule visibly changes it | Rule toggles: switch any rule off and on; the envelope recomputes and the removed volume shows as a ghost layer coloured by rule. | Toggle "Road setback": the front strip appears and disappears. |
| Accurate: floor areas add up | Per-floor table (level, use, plate m2, cumulative). Sum = GFA = FAR x site. Same numbers in the 3D, the table and the checklist. | Unit test: sum(plates) == GFA; FAR displayed == GFA / site. |
| Real site in 3D | OSM buildings (4,687 in the corridor) extruded with real heights. Untagged heights use the fallback and are shown in a lighter shade. Basemap roads and labels. Existing buildings on the plot shown as ghosts. | Open on Sukhumvit 22; towers around match reality. |
| Live, no reload | Every input change recomputes in < 50 ms and repaints the same frame. URL hash holds the state, so links reproduce a scenario. | Drag a vertex: envelope, designs and checklists move together. |
| Smooth on a normal laptop | Context layer is one static GeoJSON source; compute is pure TS on small polygons; recompute is throttled to animation frames. | Chrome performance trace on a mid-range laptop. |
| Client-ready | Clean layout, Thai/English rule names, units, legend, "print summary" view, empty and error states. | /qa pass plus a manual "try to break it" list. |
| "We will try to break it" | Validation: self-intersecting polygon, plot with no frontage, ROW < 3 m, tiny plot (< 100 m2), huge plot, zero-floor result, plot drawn far from Bangkok. Each gets a clear message, never a crash. | Break-it checklist in section 6, all run before submit. |

## 2. Architecture

- **Static site.** Vite + TypeScript, no backend, no API keys. Deploy to Vercel or Netlify, or GitHub Pages.
- **Map:** MapLibre GL 4.7 with the OpenFreeMap "liberty" style.
- **3D rendering:** MapLibre `fill-extrusion` only.
  - The envelope and the designs are stacks of floor slices (base = k x 3.2 m). A sloped 2:1 plane becomes floor-height steps. That is honest, because buildings are built in floors, and it keeps one renderer and one picking model.
  - No three.js needed.
- **Drawing:** Terra Draw (MapLibre adapter), for polygon draw and vertex edit.
- **Geometry:** `clipper2-js` (or `polygon-clipping`) for unions, differences and offsets, done in a local equirectangular metre frame centred on the plot. Distortion is under 0.1 % at plot scale.
- **Rules engine:** pure functions, `rules/*.ts`.
  - Input: plot polygon, frontage edges + ROW, zone, building type, bonus toggles.
  - Output: a list of `{id, label, source, value, limit, status, effect}` plus the envelope slices.
  - No DOM. Fully unit-tested (Vitest).
- **Design generator:** takes the envelope and rules, and returns schemes with per-floor plates, uses, unit and parking counts, and a checklist. Same engine output feeds the 3D, the tables and the checklist, so numbers can never disagree.
- **Data:** pre-baked by a Python script from the BBBike OSM extract, committed to `public/data/`. The script is kept in the repo for reproducibility.
  - `buildings.geojson`: footprint, height, height source.
  - `roads.geojson`: class, lanes, estimated ROW.
  - `stations.geojson`: BTS/MRT platforms, for the 500 m test.

## 3. The envelope algorithm

All in metres in the local frame.

1. **Ground limit.** Plot minus the union of buffers:
   - each frontage edge buffered by its road setback (MR 55 art. 41 / Ord. 50);
   - each edge buffered by the side distance (MR 55 art. 50 for < 23 m; MR 33 art. 4: 6 m for >= 23 m).
   The result is two footprints: `low` (below 23 m) and `high` (23 m and up).
2. **Height plane.** Opposite road boundary = the frontage edge's line pushed out by the ROW width. For a slice with top at z, keep only points whose distance to that line is >= z / 2 (MR 55 art. 44, Ord. 49).
   - Two roads: use the wider road where art. 45 / 46 apply; otherwise apply both planes.
   - 80 m road exception (Ord. 49).
3. **Slices.** For k = 0..N: slice_k = (z < 23 ? low : high) intersected with the height half-plane at z_top. Stop when the slice is empty. This is the **maximum envelope**.
4. **FAR cap.** Max GFA = FAR(zone) x (1 + bonus, capped at 20 %) x site area, and also <= 10 x site (MR 33 art. 5). The envelope view shows the full volume, and a "FAR line" marks where cumulative area reaches the cap.
5. **Open space.** Required open ground = max(30 % of site, OSR x GFA), with >= 50 % of the OSR area permeable. This limits the ground coverage of any design, not the envelope.
6. **Access / fire.**
   - MR 33 art. 2 (12 m frontage on a road with >= 10 m ROW; >= 18 m ROW if GFA > 30,000 m2) gates whether high-rise is allowed at all. If it fails, the envelope is capped below 23 m and below 10,000 m2.
   - The 6 m fire road (MR 33 art. 3) and the 12 m front open space (Ord. 52(6)) are design checks.

**Rule toggles.** Each step is a named rule. Turning one off skips that step, and the difference volume is drawn as a ghost in the rule's colour.

## 4. Design schemes

Each design is placed inside the envelope and must pass every rule. When a constraint stops it, the reason is shown, for example "stopped by FAR" or "stopped by the height plane".

| Scheme | Logic |
|---|---|
| **A. Tower on podium** | Podium of parking + lobby up to < 23 m on the `low` footprint, shrunk to meet open space and the 12 m front space. Tower plate = largest inscribed rectangle in `high`, max ~1,000 m2 per floor (a typical Bangkok condo plate), aligned to the frontage. Floors are added until FAR or the envelope stops it. |
| **B. Slab** | Long bar parallel to the deepest side, depth 18-22 m (double-loaded corridor), parking podium or basement. |
| **C. Twin towers** | Two smaller plates with >= the MR 55 art. 48 spacing between them. Only if the plot is big enough; otherwise "not feasible on this plot" with the reason. |

Each scheme reports:
- GFA by use: residential, parking, common;
- FAR achieved vs allowed, and height;
- floors, units (net/gross efficiency 0.75; average unit size per building type, editable);
- parking required vs provided (bays 2.40 x 5.00, 6 m aisles, about 30 m2 gross per space);
- open space and permeable area;
- the full pass/fail checklist.

**Floor table:** level, use, plate m2, cumulative m2. Sum checked against GFA.

## 5. Schedule

Times are UTC. Real elapsed time on the clock.

| Block | When | Output |
|---|---|---|
| 1. Scaffold + data bake | Nov 19, 09:00-11:30 | Vite app, MapLibre on Sukhumvit, 3D context buildings, stations, roads. Public GitHub repo. |
| 2. Geometry + rules engine | 11:30-17:00 | Setbacks, height plane, slices, FAR/OSR/open space, access gates, parking. Vitest suite with hand-checked cases. |
| 3. Inputs + envelope UI | 17:00-21:00 | Draw/edit plot, pick frontage edges, ROW, zone, type, bonuses. Live envelope. Rules panel. Rule toggles with ghost volumes. |
| Sleep | 21:00-03:00 | |
| 4. Design generator + checklists | Nov 20, 03:00-09:00 | Schemes A/B/C, floor tables, checklists, scheme switcher. |
| 5. Polish + break-it | 09:00-14:00 | Layout, legend, print view, URL state, error states, perf. /qa run, fixes. |
| 6. Deploy + review | 14:00-16:00 | Live link, /review on the diff, README. |
| 7. Write-up (you) | 16:00-22:00 | One-pager, setup answers, transcripts and note, about-you. I can fact-check; the words are yours. |
| Buffer | Nov 20 22:00 to Nov 21 06:00 | Fix anything found. Submit by **Nov 21 06:00 UTC** at the latest, about 2 h before the deadline. |

**Cut order if behind:** Twin towers (C) first, then the print view, then the 80 m road exception and corner-lot logic. Never cut rule toggles, the floor-area table or the real-site context. Those are graded directly.

## 6. Break-it checklist (run before submit)

1. Self-intersecting polygon: blocked with a message.
2. Plot with no frontage edge marked: prompt to pick one; no envelope.
3. ROW < 6 m: centreline setback applies, and high-rise is blocked (MR 33 art. 2).
4. Tiny plot (< 100 m2): "no buildable area" state.
5. Huge plot (> 10 ha): still smooth.
6. Concave L-shape and a 7-sided lot: the envelope follows the outline.
7. Plot drawn outside the data area: warning, rules still computed.
8. Each rule toggle on and off: ghost volume appears, numbers change.
9. Zone switch ย.8 / ย.9 / ย.10: FAR/OSR change, designs regenerate.
10. Each building type: parking and use checks change.
11. Sum of the floor table = GFA shown = FAR x site (within rounding), for every scheme.
12. Reload the page with a shared URL: same scenario.

## 7. What I need from you

1. **GitHub account** for a public repo (or I create the repo locally and you push it).
2. **Hosting:** Vercel, Netlify or GitHub Pages. I need you to log in to whichever you pick.
3. **Approve this plan,** or tell me what to change.
4. Keep this session exportable: it is transcript 1.

## 8. Decisions to state in the write-up

These are the calls I made where things were unclear.
- **Zone is an input, not detected.** No open machine-readable 2556 map; BMA and DOL GIS were unreachable. The demo zone is from listings.
- **Stepped envelope.** Floor-height steps instead of a true slope.
- **Road ROW is an input,** because OSM width data is almost absent.
- **Height fallback** for untagged OSM buildings, shown in a lighter shade.
- **Parking counts in FAR,** at about 30 m2 gross per space.
- **Stricter of MR 55 / MR 33 / the Bangkok ordinance** wherever they overlap.
- **B.E. 2556 treated as in force,** though the 4th revision is in draft.
